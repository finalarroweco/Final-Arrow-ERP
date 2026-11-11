import { apiJson } from "@/lib/api-response";
import { configuredApprovalRequired } from "@/lib/approval-workflows";
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
  if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return apiJson({ error: "Invalid leave decision" }, { status: 400 });
  const { tenantId, action, note } = parsed.data;
  const leave = await db.leaveRequest.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!leave) return apiJson({ error: "Leave request not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: leave.companyId,
    branchId: leave.branchId ?? undefined, permission: "leave:decide" })))
    return apiJson({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "LeaveRequest" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
    const lockedSource = await tx.leaveRequest.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!lockedSource || !(await canAccess({ userId: actor.id, tenantId, companyId: lockedSource.companyId, branchId: lockedSource.branchId ?? undefined, permission: "leave:decide" }, tx))) return { forbidden: true as const };
    const pending = await tx.$queryRaw<{ pending: boolean }[]>`SELECT EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=${tenantId}::uuid AND resource='LEAVE' AND "sourceId"=${id}::uuid AND status='PENDING') AS pending`;
    if (pending[0].pending || (action === "approve") && await configuredApprovalRequired(tx, tenantId, "LEAVE", id)) return { workflowRequired: true as const };
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
  if (result && "forbidden" in result) return apiJson({ error: "Forbidden" }, { status: 403 });
  if (result && "workflowRequired" in result) return apiJson({ error: "Use the configured approval workflow, or cancel its pending request first", workflowRequired: true, sourceId: id, resource: "LEAVE" }, { status: 409 });
  if (!result) return apiJson({ error: "Leave request status changed" }, { status: 409 });
  return apiJson({ request: result });
}
