import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { intersectBranches } from "@/lib/approval-scope";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const limit = 25;

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(query.get("tenantId"));
  const companyId = uuid.safeParse(query.get("companyId"));
  if (!tenantId.success || !companyId.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const scope = { userId: actor.id, tenantId: tenantId.data, companyId: companyId.data };
  const permissions = await Promise.all(["leave:read", "leave:decide", "expense:read", "expense:post",
    "purchase-order:read", "purchase-order:manage", "payroll:read", "payroll:approve"].map((permission) =>
    readableCompanyBranches({ ...scope, permission })));
  const leaveBranches = intersectBranches(permissions[0], permissions[1]);
  const expenseBranches = intersectBranches(permissions[2], permissions[3]);
  const purchaseBranches = intersectBranches(permissions[4], permissions[5]);
  const payrollBranches = intersectBranches(permissions[6], permissions[7]);
  if ([leaveBranches, expenseBranches, purchaseBranches, payrollBranches].every((value) => value === false))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const base = { tenantId: tenantId.data, companyId: companyId.data };
  const filter = (branches: string[] | null) => branches === null ? {} : { branchId: { in: branches } };
  const [leaves, expenses, purchases, leaveCount, expenseCount, purchaseCount, payrolls, payrollCount] = await Promise.all([
    leaveBranches === false ? [] : db.leaveRequest.findMany({ where: { ...base, ...filter(leaveBranches), status: "PENDING" },
      select: { id: true, branchId: true, createdAt: true, type: true, startDate: true, endDate: true,
        employee: { select: { fullName: true, code: true } } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit }),
    expenseBranches === false ? [] : db.expense.findMany({ where: { ...base, ...filter(expenseBranches), status: "DRAFT" },
      select: { id: true, branchId: true, createdAt: true, number: true, description: true,
        amount: true, currency: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit }),
    purchaseBranches === false ? [] : db.purchaseOrder.findMany({ where: { ...base, ...filter(purchaseBranches), status: "DRAFT" },
      select: { id: true, branchId: true, createdAt: true, number: true, supplierName: true,
        subtotal: true, currency: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit }),
    leaveBranches === false ? 0 : db.leaveRequest.count({ where: { ...base, ...filter(leaveBranches), status: "PENDING" } }),
    expenseBranches === false ? 0 : db.expense.count({ where: { ...base, ...filter(expenseBranches), status: "DRAFT" } }),
    purchaseBranches === false ? 0 : db.purchaseOrder.count({ where: { ...base, ...filter(purchaseBranches), status: "DRAFT" } }),
    payrollBranches === false ? [] : db.payrollEntry.findMany({ where: { ...base, ...filter(payrollBranches), status: "DRAFT" },
      select: { id: true, branchId: true, createdAt: true, employeeName: true, employeeCode: true, period: true,
        netPay: true, currency: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: limit }),
    payrollBranches === false ? 0 : db.payrollEntry.count({ where: { ...base, ...filter(payrollBranches), status: "DRAFT" } }),
  ]);
  const items = [
    ...leaves.map((leave) => ({ type: "LEAVE" as const, id: leave.id, branchId: leave.branchId,
      createdAt: leave.createdAt, title: `${leave.employee.fullName} · ${leave.type}`,
      detail: `${leave.employee.code} · ${leave.startDate.toISOString().slice(0, 10)} to ${leave.endDate.toISOString().slice(0, 10)}` })),
    ...expenses.map((expense) => ({ type: "EXPENSE" as const, id: expense.id, branchId: expense.branchId,
      createdAt: expense.createdAt, title: `${expense.number} · ${expense.description}`,
      detail: `${expense.amount.toString()} ${expense.currency}` })),
    ...purchases.map((purchase) => ({ type: "PURCHASE" as const, id: purchase.id, branchId: purchase.branchId,
      createdAt: purchase.createdAt, title: `${purchase.number} · ${purchase.supplierName}`,
      detail: `${purchase.subtotal.toString()} ${purchase.currency}` })),
    ...payrolls.map((entry) => ({ type: "PAYROLL" as const, id: entry.id, branchId: entry.branchId,
      createdAt: entry.createdAt, title: `${entry.employeeCode} · ${entry.employeeName}`,
      detail: `${entry.period.toISOString().slice(0, 7)} · ${entry.netPay.toString()} ${entry.currency}` })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit);
  return NextResponse.json({ items, counts: { leave: leaveCount, expense: expenseCount, purchase: purchaseCount, payroll: payrollCount },
    hasMore: leaveCount + expenseCount + purchaseCount + payrollCount > items.length });
}
