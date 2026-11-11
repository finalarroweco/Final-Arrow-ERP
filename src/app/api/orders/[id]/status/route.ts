import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  action: z.enum(["start", "complete", "cancel"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid order action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const target = action === "start" ? "IN_PROGRESS" : action === "complete" ? "COMPLETED" : "CANCELLED";
  const expected = action === "start" ? ["NEW"] : action === "complete" ? ["IN_PROGRESS"] : ["NEW", "IN_PROGRESS"];
  const now = new Date();
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
    const order = await tx.salesOrder.findUnique({where:{tenantId_id:{tenantId,id}},select:{companyId:true,branchId:true}});
    if(!order)return {error:"Order not found",statusCode:404};
    if(!await canAccess({userId:actor.id,tenantId,companyId:order.companyId,branchId:order.branchId??undefined,permission:"order:manage"},tx))return {error:"Forbidden",statusCode:403};
    const changed = await tx.salesOrder.updateMany({ where: { id, tenantId, status: { in: expected as ("NEW" | "IN_PROGRESS")[] } },
      data: { status: target, ...(action === "start" ? { startedAt: now } : action === "complete"
        ? { completedAt: now } : { cancelledAt: now }) } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `order.${action === "start" ? "started" : action === "complete" ? "completed" : "cancelled"}`,
      entity: "SalesOrder", entityId: id, metadata: { to: target } } });
    return tx.salesOrder.findUnique({ where: { id }, select: { id: true, status: true,
      startedAt: true, completedAt: true, cancelledAt: true } });
  });
  if(result&&"statusCode" in result)return NextResponse.json({error:result.error},{status:result.statusCode});
  if (!result) return NextResponse.json({ error: "Order status has changed or transition is invalid" }, { status: 409 });
  return NextResponse.json({ order: result });
}
