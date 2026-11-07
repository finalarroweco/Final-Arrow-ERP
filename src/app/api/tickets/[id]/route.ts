import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { validateEmployeeAssignment } from "@/lib/employee-assignment";

const uuid = z.string().uuid();
const schema = z.union([
  z.object({ tenantId: uuid, action: z.enum(["start", "reopen", "close"]) }).strict(),
  z.object({ tenantId: uuid, action: z.literal("resolve"),
    note: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ tenantId: uuid, action: z.literal("assign"), employeeId: uuid.nullable() }).strict(),
  z.object({ tenantId: uuid, action: z.literal("update"),
    subject: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().min(3).max(4000).optional(),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional() }).strict()
    .refine((value) => value.subject !== undefined || value.description !== undefined || value.priority !== undefined),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid ticket action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const ticket = await db.ticket.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: ticket.companyId,
    branchId: ticket.branchId ?? undefined, permission: "ticket:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (action === "assign" && parsed.data.employeeId) {
    const problem = await validateEmployeeAssignment({ userId: actor.id, tenantId,
      companyId: ticket.companyId, recordBranchId: ticket.branchId, employeeId: parsed.data.employeeId });
    if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });
  }
  const expected = action === "start" ? ["OPEN"] : action === "resolve" ? ["OPEN", "IN_PROGRESS"]
    : action === "reopen" || action === "close" ? ["RESOLVED"] : ["OPEN", "IN_PROGRESS"];
  const update = parsed.data.action === "update" ? parsed.data : null;
  const data = action === "start" ? { status: "IN_PROGRESS" as const }
    : action === "resolve" ? { status: "RESOLVED" as const, resolutionNote: parsed.data.note, resolvedAt: new Date() }
    : action === "reopen" ? { status: "OPEN" as const, resolutionNote: null, resolvedAt: null }
    : action === "close" ? { status: "CLOSED" as const, closedAt: new Date() }
    : action === "assign" ? { assigneeEmployeeId: parsed.data.employeeId }
    : { subject: update?.subject, description: update?.description, priority: update?.priority };
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.ticket.updateMany({ where: { id, tenantId,
      status: { in: expected as ("OPEN" | "IN_PROGRESS" | "RESOLVED")[] } }, data });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: `ticket.${action === "assign" ? "assigned" : action === "update" ? "updated"
        : action === "start" ? "started" : action === "resolve" ? "resolved"
          : action === "reopen" ? "reopened" : "closed"}`,
      entity: "Ticket", entityId: id,
      ...(action === "resolve" ? { metadata: { note: parsed.data.note } }
        : action === "assign" ? { metadata: { employeeId: parsed.data.employeeId } } : {}) } });
    return tx.ticket.findUnique({ where: { id }, select: { id: true, status: true,
      priority: true, assigneeEmployeeId: true, resolutionNote: true } });
  });
  if (!result) return NextResponse.json({ error: "Ticket status changed or action is invalid" }, { status: 409 });
  return NextResponse.json({ ticket: result });
}
