import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
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
  const [customerBranches, leadBranches, quoteBranches, orderBranches] = await Promise.all([
    readableCompanyBranches({ ...scope, permission: "customer:read" }),
    readableCompanyBranches({ ...scope, permission: "lead:read" }),
    readableCompanyBranches({ ...scope, permission: "quote:read" }),
    readableCompanyBranches({ ...scope, permission: "order:read" }),
  ]);
  if ([customerBranches, leadBranches, quoteBranches, orderBranches].every((value) => value === false))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const base = { tenantId: tenantId.data, companyId: companyId.data };
  const branchFilter = (branches: string[] | null) => branches === null ? {} : { branchId: { in: branches } };
  const [customers, leads, quotes, orders] = await Promise.all([
    customerBranches === false ? null : db.customer.count({ where: { ...base, ...branchFilter(customerBranches), archivedAt: null } }),
    leadBranches === false ? null : db.lead.groupBy({ by: ["stage"], where: { ...base, ...branchFilter(leadBranches) }, _count: { _all: true } }),
    quoteBranches === false ? null : db.quote.groupBy({ by: ["status"], where: { ...base, ...branchFilter(quoteBranches) }, _count: { _all: true } }),
    orderBranches === false ? null : db.salesOrder.groupBy({ by: ["status"], where: { ...base, ...branchFilter(orderBranches) }, _count: { _all: true } }),
  ]);
  const counts = <T extends string>(rows: { [key: string]: unknown; _count: { _all: number } }[] | null, key: string, statuses: readonly T[]) =>
    rows === null ? null : Object.fromEntries(statuses.map((status) => [status,
      rows.find((row) => row[key] === status)?._count._all ?? 0]));
  return NextResponse.json({
    customers,
    leads: counts(leads, "stage", ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"]),
    quotes: counts(quotes, "status", ["DRAFT", "SENT", "ACCEPTED", "REJECTED"]),
    orders: counts(orders, "status", ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  });
}
