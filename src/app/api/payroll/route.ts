import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
const uuid = z.string().uuid();
const amount = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/);
const period = z.string().regex(/^\d{4}-\d{2}$/).refine((value) => dueDate.safeParse(`${value}-01`).success);
const schema = z.object({ tenantId: uuid, companyId: uuid, employeeId: uuid, period,
  baseSalary: amount, allowances: amount, deductions: amount, note: z.string().trim().max(1000).nullish() }).strict();
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const parsed = z.object({ tenantId: uuid, companyId: uuid, period: period.optional(), page: z.coerce.number().int().min(0).max(100000).default(0) })
    .safeParse(Object.fromEntries(["tenantId", "companyId", "period", "page"].filter((key) => query.has(key)).map((key) => [key, query.get(key)])));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payroll scope" }, { status: 400 });
  const { tenantId, companyId, period: month, page } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "payroll:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await db.payrollEntry.findMany({ where: { tenantId, companyId,
    ...(branches === null ? {} : { branchId: { in: branches } }), ...(month ? { period: new Date(`${month}-01T00:00:00.000Z`) } : {}) },
    orderBy: [{ period: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: page * 50, take: 51 });
  return NextResponse.json({ entries: entries.slice(0, 50), nextPage: entries.length > 50 ? page + 1 : null });
}
export async function POST(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payroll entry" }, { status: 400 });
  const { tenantId, companyId, employeeId, period: month, baseSalary, allowances, deductions, note } = parsed.data;
  const employee = await db.employee.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: employeeId } } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId, branchId: employee.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "payroll:create" })) || !(await canAccess({ ...scope, permission: "employee:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (employee.status !== "ACTIVE") return NextResponse.json({ error: "Employee is inactive" }, { status: 409 });
  const netPay = new Prisma.Decimal(baseSalary).plus(allowances).minus(deductions);
  if (netPay.isNegative()) return NextResponse.json({ error: "Deductions exceed gross pay" }, { status: 400 });
  const company = await db.company.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: companyId } }, select: { baseCurrency: true } });
  try {
    const entry = await db.$transaction(async (tx) => {
      const entry = await tx.payrollEntry.create({ data: { tenantId, companyId, branchId: employee.branchId, employeeId,
        employeeName: employee.fullName, employeeCode: employee.code, period: new Date(`${month}-01T00:00:00.000Z`),
        baseSalary, allowances, deductions, netPay, currency: company.baseCurrency, note: note ?? null, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "payroll.created", entity: "PayrollEntry", entityId: entry.id } });
      return entry;
    });
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Payroll already exists for this employee and month" }, { status: 409 });
    throw error;
  }
}
