import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.union([
  z.object({ tenantId: uuid, action: z.literal("approve"),
    note: z.string().trim().max(500).nullish() }).strict(),
  z.object({ tenantId: uuid, action: z.enum(["reject", "cancel"]),
    note: z.string().trim().min(3).max(500) }).strict(),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid leave decision" }, { status: 400 });
  const { tenantId, action, note } = parsed.data;
  const leave = await db.leaveRequest.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!leave) return NextResponse.json({ error: "Leave request not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: leave.companyId,
    branchId: leave.branchId ?? undefined, permission: "leave:decide" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.leaveRequest.updateMany({ where: { id, tenantId,
      status: action === "cancel" ? { in: ["PENDING", "APPROVED"] } : "PENDING" },
      data: { status: action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "CANCELLED",
        decisionNote: note ?? null, decidedAt: new Date(), decidedBy: actor.id } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: `leave-request.${action === "approve" ? "approved" : action === "reject" ? "rejected" : "cancelled"}`,
      entity: "LeaveRequest", entityId: id, ...(note ? { metadata: { note } } : {}) } });
    return tx.leaveRequest.findUnique({ where: { id }, select: { id: true, status: true,
      decisionNote: true, decidedAt: true } });
  });
  if (!result) return NextResponse.json({ error: "Leave request status changed" }, { status: 409 });
  return NextResponse.json({ request: result });
}
