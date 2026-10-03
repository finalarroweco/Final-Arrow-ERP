import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, branchId: uuid,
  lines: z.array(z.object({ orderLineId: uuid, itemId: uuid }).strict()).min(1).max(50),
}).strict();
class ReceiptConflict extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid goods receipt" }, { status: 400 });
  const { tenantId, branchId, lines } = parsed.data;
  const order = await db.purchaseOrder.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true, status: true, number: true,
      lines: { select: { id: true, quantity: true } } } });
  if (!order) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  const companyId = order.companyId;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId,
    branchId: order.branchId ?? undefined, permission: "purchase-order:manage" })) ||
    !(await canAccess({ userId: actor.id, tenantId, companyId, branchId,
      permission: "inventory-stock:adjust" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (order.branchId && order.branchId !== branchId)
    return NextResponse.json({ error: "Receiving branch does not match the order" }, { status: 409 });
  if (order.status !== "ISSUED")
    return NextResponse.json({ error: "Only issued orders can be received" }, { status: 409 });
  if (lines.length !== order.lines.length || new Set(lines.map((line) => line.orderLineId)).size !== lines.length ||
    order.lines.some((line) => !lines.some((input) => input.orderLineId === line.id)))
    return NextResponse.json({ error: "Map every order line exactly once" }, { status: 400 });
  const branch = await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } },
    select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const items = await db.inventoryItem.findMany({ where: { tenantId, companyId, id: { in: itemIds } },
    select: { id: true, branchId: true, archivedAt: true } });
  if (items.length !== itemIds.length || items.some((item) => item.archivedAt ||
    (item.branchId && item.branchId !== branchId)))
    return NextResponse.json({ error: "Item is archived or outside receiving branch" }, { status: 409 });
  const max = new Prisma.Decimal("999999999999999.999");
  try {
    const receipt = await db.$transaction(async (tx) => {
      const changed = await tx.purchaseOrder.updateMany({ where: { id, tenantId, status: "ISSUED" },
        data: { status: "RECEIVED", receivedAt: new Date() } });
      if (changed.count !== 1) throw new ReceiptConflict();
      const receipt = await tx.goodsReceipt.create({ data: { tenantId, companyId, branchId,
        orderId: id, createdBy: actor.id } });
      for (const line of order.lines) {
        const itemId = lines.find((input) => input.orderLineId === line.id)!.itemId;
        const quantity = new Prisma.Decimal(line.quantity);
        const item = await tx.inventoryItem.findUnique({ where: { tenantId_companyId_id: {
          tenantId, companyId, id: itemId } }, select: { branchId: true, archivedAt: true } });
        if (!item || item.archivedAt || (item.branchId && item.branchId !== branchId)) throw new ReceiptConflict();
        const balance = await tx.stockBalance.upsert({ where: { tenantId_companyId_branchId_itemId: {
          tenantId, companyId, branchId, itemId } }, create: { tenantId, companyId, branchId, itemId }, update: {} });
        const incremented = await tx.stockBalance.updateMany({ where: { id: balance.id,
          quantity: { lte: max.sub(quantity) } }, data: { quantity: { increment: quantity } } });
        if (incremented.count !== 1) throw new ReceiptConflict();
        const receiptLine = await tx.goodsReceiptLine.create({ data: { tenantId, companyId, orderId: id,
          receiptId: receipt.id, orderLineId: line.id, itemId, quantity } });
        await tx.stockMovement.create({ data: { tenantId, balanceId: balance.id, type: "PURCHASE_RECEIPT",
          delta: quantity, reason: `Purchase order ${order.number}`, actorId: actor.id,
          receiptLineId: receiptLine.id } });
      }
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "purchase-order.received",
        entity: "PurchaseOrder", entityId: id, metadata: { receiptId: receipt.id, branchId } } });
      return tx.goodsReceipt.findUnique({ where: { id: receipt.id }, include: { lines: true } });
    });
    return NextResponse.json({ receipt }, { status: 201 });
  } catch (error) {
    if (error instanceof ReceiptConflict || (typeof error === "object" && error && "code" in error && error.code === "P2002"))
      return NextResponse.json({ error: "Purchase order already received or stock limit reached" }, { status: 409 });
    throw error;
  }
}
