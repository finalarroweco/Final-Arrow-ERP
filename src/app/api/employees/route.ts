import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, companyId: uuid, branchId: uuid.nullish(),
  code: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  fullName: z.string().trim().min(2).max(160),
  jobTitle: z.string().trim().max(120).nullish(),
  email: z.string().trim().email().max(255).nullish(),
  phone: z.string().trim().max(40).nullish(),
  startDate: dueDate.nullish() }).strict();

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
    companyId: companyId.data, permission: "employee:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const employees = await db.employee.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    status: params.get("inactive") === "true" ? "INACTIVE" : "ACTIVE",
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, code: true, fullName: true, jobTitle: true, email: true,
      phone: true, startDate: true, status: true, branchId: true },
    orderBy: [{ fullName: "asc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ employees: employees.slice(0, 50), nextPage: employees.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid employee" }, { status: 400 });
  const { tenantId, companyId, branchId, startDate, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "employee:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  try {
    const employee = await db.$transaction(async (tx) => {
      const employee = await tx.employee.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        ...data, startDate: startDate ? new Date(`${startDate}T00:00:00.000Z`) : null, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "employee.created",
        entity: "Employee", entityId: employee.id } });
      return employee;
    });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Employee code already in use" }, { status: 409 });
    throw error;
  }
}
