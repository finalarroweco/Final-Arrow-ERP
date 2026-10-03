import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { validateEmployeeAssignment } from "@/lib/employee-assignment";

const uuid = z.string().uuid();
const schema = z.union([
  z.object({ tenantId: uuid, action: z.enum(["start", "complete", "cancel"]) }).strict(),
  z.object({ tenantId: uuid, action: z.literal("assign"), employeeId: uuid.nullable() }).strict(),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id, taskId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !uuid.safeParse(taskId).success || !parsed.success)
    return NextResponse.json({ error: "Invalid task action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: project.companyId,
    branchId: project.branchId ?? undefined, permission: "project-task:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (action === "assign" && parsed.data.employeeId) {
    const problem = await validateEmployeeAssignment({ userId: actor.id, tenantId,
      companyId: project.companyId, recordBranchId: project.branchId, employeeId: parsed.data.employeeId });
    if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });
  }
  const expected: ("TODO" | "IN_PROGRESS")[] = action === "start" ? ["TODO"] : ["TODO", "IN_PROGRESS"];
  const result = await db.$transaction(async (tx) => {
    const active = await tx.project.updateMany({ where: { id, tenantId,
      status: action === "assign" ? { in: ["PLANNED", "ACTIVE"] } : "ACTIVE" },
      data: { updatedAt: new Date() } });
    if (active.count !== 1) return null;
    const changed = await tx.projectTask.updateMany({ where: { id: taskId, tenantId,
      projectId: id, companyId: project.companyId, status: { in: expected } },
      data: action === "assign" ? { assigneeEmployeeId: parsed.data.employeeId }
        : { status: action === "start" ? "IN_PROGRESS" : action === "complete" ? "DONE" : "CANCELLED",
          ...(action === "complete" ? { completedAt: new Date() } : {}) } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: `project-task.${action === "assign" ? "assigned" : action === "start" ? "started" : action === "complete" ? "completed" : "cancelled"}`,
      entity: "ProjectTask", entityId: taskId, metadata: action === "assign"
        ? { projectId: id, employeeId: parsed.data.employeeId } : { projectId: id } } });
    return tx.projectTask.findUnique({ where: { id: taskId }, select: { id: true, status: true,
      completedAt: true, assigneeEmployeeId: true } });
  });
  if (!result) return NextResponse.json({ error: "Task or project status does not allow this action" }, { status: 409 });
  return NextResponse.json({ task: result });
}
