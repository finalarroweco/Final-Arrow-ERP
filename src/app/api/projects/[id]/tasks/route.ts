import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullish(), dueDate: dueDate.nullish() }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const query = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(query.get("tenantId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(query.get("page") ?? "0");
  if (!uuid.safeParse(id).success || !tenantId.success || !page.success)
    return NextResponse.json({ error: "Invalid project scope" }, { status: 400 });
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId: tenantId.data, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId: tenantId.data, companyId: project.companyId,
    branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) ||
    !(await canAccess({ ...scope, permission: "project-task:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tasks = await db.projectTask.findMany({ where: { tenantId: tenantId.data,
    companyId: project.companyId, projectId: id },
    select: { id: true, title: true, description: true, status: true,
      dueDate: true, completedAt: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ tasks: tasks.slice(0, 50), nextPage: tasks.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid project task" }, { status: 400 });
  const { tenantId, dueDate: date, ...data } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: project.companyId,
    branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) ||
    !(await canAccess({ ...scope, permission: "project-task:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const task = await db.$transaction(async (tx) => {
    const changed = await tx.project.updateMany({ where: { id, tenantId,
      status: { in: ["PLANNED", "ACTIVE"] } }, data: { updatedAt: new Date() } });
    if (changed.count !== 1) return null;
    const task = await tx.projectTask.create({ data: { tenantId, companyId: project.companyId,
      projectId: id, ...data, dueDate: date ? new Date(`${date}T00:00:00.000Z`) : null,
      createdBy: actor.id } });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "project-task.created",
      entity: "ProjectTask", entityId: task.id, metadata: { projectId: id } } });
    return task;
  });
  if (!task) return NextResponse.json({ error: "Project does not accept new tasks" }, { status: 409 });
  return NextResponse.json({ task }, { status: 201 });
}
