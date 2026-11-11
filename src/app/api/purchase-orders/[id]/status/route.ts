import { configuredApprovalRequired } from "@/lib/approval-workflows";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, action: z.enum(["issue", "cancel"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid purchase order action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const order = await db.purchaseOrder.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!order) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: order.companyId,
    branchId: order.branchId ?? undefined, permission: "purchase-order:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = action === "issue" ? "ISSUED" : "CANCELLED";
  const expected = "DRAFT";
  const field = action === "issue" ? "issuedAt" : "cancelledAt";
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
    const lockedSource = await tx.purchaseOrder.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!lockedSource || !(await canAccess({ userId: actor.id, tenantId, companyId: lockedSource.companyId, branchId: lockedSource.branchId ?? undefined, permission: "purchase-order:manage" }, tx))) return { forbidden: true as const };
    const pending = await tx.$queryRaw<{ pending: boolean }[]>`SELECT EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=${tenantId}::uuid AND resource='PURCHASE' AND "sourceId"=${id}::uuid AND status='PENDING') AS pending`;
    if (pending[0].pending || (action === "issue") && await configuredApprovalRequired(tx, tenantId, "PURCHASE", id)) return { workflowRequired: true as const };
    const changed = await tx.purchaseOrder.updateMany({ where: { id, tenantId, status: expected },
      data: { status, [field]: new Date() } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `purchase-order.${action === "issue" ? "issued" : "cancelled"}`,
      entity: "PurchaseOrder", entityId: id, metadata: { from: expected, to: status } } });
    return tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true,
      issuedAt: true, receivedAt: true, cancelledAt: true } });
  });
  if (result && "forbidden" in result) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (result && "workflowRequired" in result) return NextResponse.json({ error: "Use the configured approval workflow, or cancel its pending request first", workflowRequired: true, sourceId: id, resource: "PURCHASE" }, { status: 409 });
  if (!result) return NextResponse.json({ error: "Purchase order status has changed or transition is invalid" }, { status: 409 });
  return NextResponse.json({ order: result });
}
