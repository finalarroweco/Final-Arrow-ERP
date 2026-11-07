import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, companyId: uuid, employeeId: uuid, workDate: dueDate,
  startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440).nullish(),
  note: z.string().trim().max(1000).nullish() }).strict()
  .refine((value) => value.endMinute == null || value.endMinute > value.startMinute);

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const filters = z.object({ q: z.string().trim().max(160).optional(),
    from: dueDate.optional(), to: dueDate.optional(), branchId: uuid.optional(),
    status: z.enum(["all", "open", "completed"]).default("all") })
    .refine((value) => !value.from || !value.to || value.from <= value.to)
    .safeParse(Object.fromEntries(["q", "from", "to", "branchId", "status"]
      .filter((key) => params.has(key)).map((key) => [key, params.get(key)])));
  if (!filters.success) return NextResponse.json({ error: "Invalid attendance filters" }, { status: 400 });
  const { q, from, to, branchId, status } = filters.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId: tenantId.data,
    companyId: companyId.data, permission: "attendance:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const records = await db.attendanceRecord.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branchId ? { branchId } : branches === null ? {} : { branchId: { in: branches } }),
    ...(from || to ? { workDate: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}) } } : {}),
    ...(status === "open" ? { endMinute: null } : status === "completed" ? { endMinute: { not: null } } : {}),
    ...(q ? { employee: { OR: [{ fullName: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } }] } } : {}) },
    select: { id: true, employeeId: true, employee: { select: { fullName: true, code: true } },
      branchId: true, workDate: true, startMinute: true, endMinute: true, note: true, createdAt: true },
    orderBy: [{ workDate: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ records: records.slice(0, 50), nextPage: records.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid attendance record or time" }, { status: 400 });
  const { tenantId, companyId, employeeId, workDate, startMinute, endMinute, note } = parsed.data;
  const employee = await db.employee.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: employeeId } },
    select: { branchId: true, status: true } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId, branchId: employee.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "attendance:manage" })) ||
    !(await canAccess({ ...scope, permission: "employee:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (employee.status !== "ACTIVE") return NextResponse.json({ error: "Employee is inactive" }, { status: 409 });
  try {
    const record = await db.$transaction(async (tx) => {
      const record = await tx.attendanceRecord.create({ data: { tenantId, companyId, branchId: employee.branchId,
        employeeId, workDate: new Date(`${workDate}T00:00:00.000Z`), startMinute,
        endMinute: endMinute ?? null, note: note ?? null, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "attendance.created",
        entity: "AttendanceRecord", entityId: record.id } });
      return record;
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Attendance already recorded for this employee and date" }, { status: 409 });
    throw error;
  }
}
