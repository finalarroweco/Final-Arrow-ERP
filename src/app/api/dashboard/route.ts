import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyPermissions } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  if (!tenantId.success || !companyId.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const scope = { userId: actor.id, tenantId: tenantId.data, companyId: companyId.data };
  const permissions = ["customer:read", "lead:read", "quote:read", "order:read",
    "project:read", "employee:read", "expense:read", "ticket:read"];
  const access = await readableCompanyPermissions({ ...scope, permissions });
  const [customerBranches, leadBranches, quoteBranches, orderBranches,
    projectBranches, employeeBranches, expenseBranches, ticketBranches] = permissions.map(key => access[key]);
  if ([customerBranches, leadBranches, quoteBranches, orderBranches,
    projectBranches, employeeBranches, expenseBranches, ticketBranches].every((value) => value === false))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const base = { tenantId: tenantId.data, companyId: companyId.data };
  const branchFilter = (branches: string[] | null) => branches === null ? {} : { branchId: { in: branches } };
  const [customers, leads, quotes, orders, projects, employees, expenses, company, tickets] = await Promise.all([
    customerBranches === false ? null : db.customer.count({ where: { ...base, ...branchFilter(customerBranches), archivedAt: null } }),
    leadBranches === false ? null : db.lead.groupBy({ by: ["stage"], where: { ...base, ...branchFilter(leadBranches) }, _count: { _all: true } }),
    quoteBranches === false ? null : db.quote.groupBy({ by: ["status"], where: { ...base, ...branchFilter(quoteBranches) }, _count: { _all: true } }),
    orderBranches === false ? null : db.salesOrder.groupBy({ by: ["status"], where: { ...base, ...branchFilter(orderBranches) }, _count: { _all: true } }),
    projectBranches === false ? null : db.project.groupBy({ by: ["status"], where: { ...base, ...branchFilter(projectBranches) }, _count: { _all: true } }),
    employeeBranches === false ? null : db.employee.count({ where: { ...base, ...branchFilter(employeeBranches), status: "ACTIVE" } }),
    expenseBranches === false ? null : db.expense.aggregate({ where: { ...base, ...branchFilter(expenseBranches),
      status: "POSTED" }, _sum: { amount: true }, _count: { _all: true } }),
    expenseBranches === false ? null : db.company.findUnique({ where: { tenantId_id: { tenantId: tenantId.data,
      id: companyId.data } }, select: { baseCurrency: true } }),
    ticketBranches === false ? null : db.ticket.groupBy({ by: ["status"], where: { ...base,
      ...branchFilter(ticketBranches) }, _count: { _all: true } }),
  ]);
  const counts = <T extends string>(rows: { [key: string]: unknown; _count: { _all: number } }[] | null, key: string, statuses: readonly T[]) =>
    rows === null ? null : Object.fromEntries(statuses.map((status) => [status,
      rows.find((row) => row[key] === status)?._count._all ?? 0]));
  return NextResponse.json({
    customers,
    leads: counts(leads, "stage", ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"]),
    quotes: counts(quotes, "status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED"]),
    orders: counts(orders, "status", ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
    projects: counts(projects, "status", ["PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]),
    tickets: counts(tickets, "status", ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
    employees,
    expenses: expenses === null ? null : { currency: company?.baseCurrency ?? "",
      postedCount: expenses._count._all,
      postedAmount: expenses._sum.amount?.toString() ?? "0" },
  });
}
