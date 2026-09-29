import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, action: z.enum(["issue", "receive", "cancel"]) }).strict();

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
  const status = action === "issue" ? "ISSUED" : action === "receive" ? "RECEIVED" : "CANCELLED";
  const expected = action === "receive" ? "ISSUED" : "DRAFT";
  const field = action === "issue" ? "issuedAt" : action === "receive" ? "receivedAt" : "cancelledAt";
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.purchaseOrder.updateMany({ where: { id, tenantId, status: expected },
      data: { status, [field]: new Date() } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `purchase-order.${action === "issue" ? "issued" : action === "receive" ? "received" : "cancelled"}`,
      entity: "PurchaseOrder", entityId: id, metadata: { from: expected, to: status } } });
    return tx.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true,
      issuedAt: true, receivedAt: true, cancelledAt: true } });
  });
  if (!result) return NextResponse.json({ error: "Purchase order status has changed or transition is invalid" }, { status: 409 });
  return NextResponse.json({ order: result });
}
