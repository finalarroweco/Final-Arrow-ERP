import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, companyId: uuid, employeeId: uuid,
  type: z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]),
  startDate: dueDate, endDate: dueDate,
  note: z.string().trim().max(1000).nullish() }).strict()
  .refine((value) => value.startDate <= value.endDate);

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId: tenantId.data,
    companyId: companyId.data, permission: "leave:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const requests = await db.leaveRequest.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, employeeId: true, employee: { select: { fullName: true, code: true } },
      branchId: true, type: true, startDate: true, endDate: true, note: true,
      status: true, decisionNote: true, decidedAt: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ requests: requests.slice(0, 50), nextPage: requests.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid leave request or date range" }, { status: 400 });
  const { tenantId, companyId, employeeId, startDate, endDate, type, note } = parsed.data;
  const employee = await db.employee.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: employeeId } },
    select: { branchId: true, status: true } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId, branchId: employee.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "leave:create" })) ||
    !(await canAccess({ ...scope, permission: "employee:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (employee.status !== "ACTIVE") return NextResponse.json({ error: "Employee is inactive" }, { status: 409 });
  const leave = await db.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.create({ data: { tenantId, companyId, branchId: employee.branchId,
      employeeId, type, startDate: new Date(`${startDate}T00:00:00.000Z`),
      endDate: new Date(`${endDate}T00:00:00.000Z`), note: note ?? null, createdBy: actor.id } });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "leave-request.created",
      entity: "LeaveRequest", entityId: leave.id } });
    return leave;
  });
  return NextResponse.json({ request: leave }, { status: 201 });
}
