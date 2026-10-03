import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { dueDate } from "@/lib/date";
import { db } from "@/lib/db";
const keys = ["tenantId", "companyId", "period", "branchId", "status", "q", "format"];
const schema = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/).refine((v) => dueDate.safeParse(`${v}-01`).success),
  branchId: z.string().uuid().optional(), status: z.enum(["DRAFT", "APPROVED", "PAID", "VOID"]).optional(),
  q: z.string().trim().max(120).optional(), format: z.enum(["json", "csv"]).default("json") });
const cell = (value: string) => `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if (keys.some((key) => params.getAll(key).length > 1)) return NextResponse.json({ error: "Duplicate report parameter" }, { status: 400 });
  const parsed = schema.safeParse(Object.fromEntries(keys.filter((key) => params.has(key)).map((key) => [key, params.get(key)])));
  if (!parsed.success) return NextResponse.json({ error: "Invalid monthly report filters" }, { status: 400 });
  const { tenantId, companyId, period, branchId, status, q, format } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "payroll:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await db.payrollEntry.findMany({ where: { tenantId, companyId, period: new Date(`${period}-01T00:00:00Z`),
    ...(branchId ? { branchId } : branches === null ? {} : { branchId: { in: branches } }),
    ...(status ? { status } : {}), ...(q ? { OR: [{ employeeName: { contains: q, mode: "insensitive" as const } }, { employeeCode: { contains: q, mode: "insensitive" as const } }] } : {}) },
    select: { employeeName: true, employeeCode: true, branchId: true, status: true, baseSalary: true, allowances: true, deductions: true, netPay: true, currency: true, paymentReference: true },
    orderBy: [{ employeeCode: "asc" }, { id: "asc" }], take: 5001 });
  if (entries.length > 5000) return NextResponse.json({ error: "Report exceeds 5000 entries. Narrow the filters." }, { status: 413 });
  const names = new Map((await db.branch.findMany({ where: { tenantId, companyId, id: { in: [...new Set(entries.flatMap((entry) => entry.branchId ? [entry.branchId] : []))] } }, select: { id: true, name: true } })).map((branch) => [branch.id, branch.name]));
  const groups = new Map<string, { status: string; currency: string; count: number; baseSalary: Prisma.Decimal; allowances: Prisma.Decimal; deductions: Prisma.Decimal; netPay: Prisma.Decimal }>();
  for (const entry of entries) {
    const key = `${entry.status}:${entry.currency}`;
    const group = groups.get(key) ?? { status: entry.status, currency: entry.currency, count: 0, baseSalary: new Prisma.Decimal(0), allowances: new Prisma.Decimal(0), deductions: new Prisma.Decimal(0), netPay: new Prisma.Decimal(0) };
    group.count++;
    for (const field of ["baseSalary", "allowances", "deductions", "netPay"] as const) group[field] = group[field].plus(entry[field]);
    groups.set(key, group);
  }
  const summary = [...groups.values()].map((group) => ({ ...group, baseSalary: group.baseSalary.toFixed(3), allowances: group.allowances.toFixed(3), deductions: group.deductions.toFixed(3), netPay: group.netPay.toFixed(3) }));
  if (format === "json") return NextResponse.json({ period, count: entries.length, summary }, { headers: { "Cache-Control": "private, no-store" } });
  const rows = [["Month", "Employee code", "Employee name", "Branch", "Status", "Base salary", "Allowances", "Deductions", "Net pay", "Currency", "Payment reference"],
    ...entries.map((entry) => [period, entry.employeeCode, entry.employeeName, entry.branchId ? names.get(entry.branchId) ?? "" : "", entry.status, entry.baseSalary.toFixed(3), entry.allowances.toFixed(3), entry.deductions.toFixed(3), entry.netPay.toFixed(3), entry.currency, entry.paymentReference ?? ""])];
  return new Response(`\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payroll-${period}.csv"`, "Cache-Control": "private, no-store" } });
}
