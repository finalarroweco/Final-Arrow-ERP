import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, branchId: uuid, requestId: uuid.optional(),
  lines: z.array(z.object({ orderLineId: uuid, itemId: uuid,
    quantity: z.number().int().min(1).max(100000).optional() }).strict()).min(1).max(50),
}).strict().refine(v => !v.lines.some(l => l.quantity !== undefined) ||
  Boolean(v.requestId && v.lines.every(l => l.quantity !== undefined)));
class ReceiptConflict extends Error { constructor(message:string,public status=409){super(message);} }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid receipt: partial quantities require a request ID and whole units" }, { status: 400 });
  const { tenantId, branchId, lines, requestId } = parsed.data;
  const order = await db.purchaseOrder.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!order) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  const companyId = order.companyId;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId,
    branchId: order.branchId ?? undefined, permission: "purchase-order:manage" })) ||
    !(await canAccess({ userId: actor.id, tenantId, companyId, branchId, permission: "inventory-stock:adjust" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (order.branchId && order.branchId !== branchId)
    return NextResponse.json({ error: "Receiving branch does not match the order" }, { status: 409 });
  if (new Set(lines.map(line => line.orderLineId)).size !== lines.length)
    return NextResponse.json({ error: "Map each submitted order line exactly once" }, { status: 400 });
  const branch = await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const max = new Prisma.Decimal("999999999999999.999");
  try {
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id"=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
      const current = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });
      const quantities = lines.map(input => {
        const source = current.lines.find(l => l.id === input.orderLineId);
        if (!source) throw new ReceiptConflict("Order line is outside this purchase order",400);
        return {...input,quantity:input.quantity ?? source.quantity};
      });
      // A replay is accepted only for exactly the same authorised order, branch and payload.
      if (requestId) {
        const saved = await tx.goodsReceipt.findUnique({where:{id:requestId},include:{lines:true}});
        if (saved) {
          if (saved.tenantId!==tenantId || saved.companyId!==companyId || saved.orderId!==id || saved.branchId!==branchId ||
            saved.lines.length!==quantities.length || saved.lines.some(l => !quantities.some(q => q.orderLineId===l.orderLineId && q.itemId===l.itemId && l.quantity.equals(q.quantity))))
            throw new ReceiptConflict("Request ID was already used for a different receipt");
          return {receipt:saved,orderStatus:current.status,replayed:true};
        }
      }
      if (current.status!=="ISSUED") throw new ReceiptConflict("Only issued orders with remaining quantities can be received");
      if (lines.every(l=>l.quantity===undefined) && lines.length!==current.lines.length)
        throw new ReceiptConflict("Full receipt must map every order line",400);
      for (const line of quantities) {
        const source=current.lines.find(l=>l.id===line.orderLineId)!;
        if (line.quantity>source.quantity-source.receivedQuantity) throw new ReceiptConflict("Receipt exceeds remaining order quantity");
      }
      const itemIds=[...new Set(quantities.map(l=>l.itemId))];
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "InventoryItem" WHERE "tenantId"=${tenantId}::uuid AND "companyId"=${companyId}::uuid AND "id" IN (${Prisma.join(itemIds.map(itemId=>Prisma.sql`${itemId}::uuid`))}) ORDER BY "id" FOR UPDATE`);
      const items=await tx.inventoryItem.findMany({where:{tenantId,companyId,id:{in:itemIds}},select:{id:true,branchId:true,archivedAt:true}});
      if (items.length!==itemIds.length || items.some(item=>item.archivedAt || (item.branchId && item.branchId!==branchId)))
        throw new ReceiptConflict("Item is archived or outside receiving branch");
      const receipt=await tx.goodsReceipt.create({data:{...(requestId?{id:requestId}:{}),tenantId,companyId,branchId,orderId:id,createdBy:actor.id}});
      // Consistent item ordering prevents competing orders from acquiring stock locks in opposite order.
      for (const line of quantities.sort((a,b)=>a.itemId.localeCompare(b.itemId)||a.orderLineId.localeCompare(b.orderLineId))) {
        const quantity=new Prisma.Decimal(line.quantity),itemId=line.itemId;
        const balance=await tx.stockBalance.upsert({where:{tenantId_companyId_branchId_itemId:{tenantId,companyId,branchId,itemId}},create:{tenantId,companyId,branchId,itemId},update:{}});
        const changed=await tx.stockBalance.updateMany({where:{id:balance.id,quantity:{lte:max.sub(quantity)}},data:{quantity:{increment:quantity}}});
        if (changed.count!==1) throw new ReceiptConflict("Stock limit reached");
        const receiptLine=await tx.goodsReceiptLine.create({data:{tenantId,companyId,orderId:id,receiptId:receipt.id,orderLineId:line.orderLineId,itemId,quantity}});
        await tx.stockMovement.create({data:{tenantId,balanceId:balance.id,type:"PURCHASE_RECEIPT",delta:quantity,reason:`Purchase order ${current.number}`,actorId:actor.id,receiptLineId:receiptLine.id}});
      }
      const remaining=await tx.purchaseOrderLine.findMany({where:{tenantId,orderId:id},select:{quantity:true,receivedQuantity:true}});
      const complete=remaining.every(l=>l.quantity===l.receivedQuantity);
      if (complete) await tx.purchaseOrder.update({where:{id},data:{status:"RECEIVED",receivedAt:new Date()}});
      await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:complete?"purchase-order.received":"purchase-order.partially_received",entity:"PurchaseOrder",entityId:id,metadata:{receiptId:receipt.id,branchId,complete}}});
      return {receipt:await tx.goodsReceipt.findUniqueOrThrow({where:{id:receipt.id},include:{lines:true}}),orderStatus:complete?"RECEIVED":"ISSUED",replayed:false};
    },{timeout:20000,maxWait:10000});
    return NextResponse.json(result,{status:201});
  } catch(error) {
    if (error instanceof ReceiptConflict) return NextResponse.json({error:error.message},{status:error.status});
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002","P2004","P2034"].includes(error.code))
      return NextResponse.json({error:"Receipt conflict or stock limit reached. Reload and retry."},{status:409});
    throw error;
  }
}
