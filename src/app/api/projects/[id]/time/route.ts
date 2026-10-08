import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { validateEmployeeAssignment } from "@/lib/employee-assignment";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, employeeId: uuid, workDate: dueDate,
  minutes: z.number().int().min(1).max(1440), description: z.string().trim().min(3).max(1000) }).strict();

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
  const scope = { userId: actor.id, tenantId: tenantId.data, companyId: project.companyId, branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) || !(await canAccess({ ...scope, permission: "project-time:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const where = { tenantId: tenantId.data, companyId: project.companyId, projectId: id };
  const [entries, total] = await db.$transaction([
    db.projectTimeEntry.findMany({ where, include: { employee: { select: { fullName: true, code: true, branchId: true } } },
      orderBy: [{ workDate: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 }),
    db.projectTimeEntry.aggregate({ where: { ...where, voidedAt: null }, _sum: { minutes: true }, _count: true }),
  ]);
  const visible = entries.slice(0, 50);
  const keys = [...new Set(visible.map((entry) => entry.employee.branchId ?? ""))];
  const rights = new Map(await Promise.all(keys.map(async (branchId) => [branchId,
    await canAccess({ ...scope, branchId: branchId || undefined, permission: "employee:read" })] as const)));
  return NextResponse.json({ entries: visible.map(({ employee, ...entry }) => ({ ...entry,
    employeeName: rights.get(employee.branchId ?? "") ? employee.fullName : null,
    employeeCode: rights.get(employee.branchId ?? "") ? employee.code : null })),
    totalMinutes: total._sum.minutes ?? 0, count: total._count, nextPage: entries.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid time entry" }, { status: 400 });
  const { tenantId, employeeId, workDate, minutes, description } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } }, select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: project.companyId, branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) || !(await canAccess({ ...scope, permission: "project-time:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const problem = await validateEmployeeAssignment({ ...scope, recordBranchId: project.branchId, employeeId });
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });
  const entry = await db.$transaction(async (tx) => {
    const changed = await tx.project.updateMany({ where: { tenantId, id, status: "ACTIVE" }, data: { updatedAt: new Date() } });
    if (changed.count !== 1) return null;
    const entry = await tx.projectTimeEntry.create({ data: { tenantId, companyId: project.companyId, projectId: id,
      employeeId, workDate: new Date(`${workDate}T00:00:00.000Z`), minutes, description, createdBy: actor.id } });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "project-time.created",
      entity: "ProjectTimeEntry", entityId: entry.id, metadata: { projectId: id, minutes } } });
    return entry;
  });
  if (!entry) return NextResponse.json({ error: "Only active projects accept time entries" }, { status: 409 });
  return NextResponse.json({ entry }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = z.object({ tenantId: uuid, entryId: uuid, reason: z.string().trim().min(3).max(500) })
    .strict().safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid time correction" }, { status: 400 });
  const { tenantId, entryId, reason } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } }, select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: project.companyId, branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) || !(await canAccess({ ...scope, permission: "project-time:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    const locked = await tx.project.updateMany({ where: { tenantId, id, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } }, data: { updatedAt: new Date() } });
    if (locked.count !== 1) return false;
    const changed = await tx.projectTimeEntry.updateMany({ where: { id: entryId, tenantId, companyId: project.companyId, projectId: id, voidedAt: null },
      data: { voidedAt: new Date(), voidReason: reason } });
    if (changed.count !== 1) return false;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "project-time.voided", entity: "ProjectTimeEntry",
      entityId: entryId, metadata: { projectId: id, reason } } });
    return true;
  });
  if (!result) return NextResponse.json({ error: "Entry already voided, unavailable, or project closed" }, { status: 409 });
  return NextResponse.json({ success: true });
}
