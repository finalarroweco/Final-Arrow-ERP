import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { journalFilters, journalWhere, queryInput } from "@/lib/ledger";
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = journalFilters.safeParse(queryInput(new URL(request.url).searchParams, ["tenantId", "companyId", "branchId", "from", "to"]));
  if (!parsed.success) return NextResponse.json({ error: "Invalid trial balance filters" }, { status: 400 });
  const { tenantId, companyId, branchId } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "ledger:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const lines = await db.journalLine.findMany({ where: { tenantId, companyId, entry: journalWhere(parsed.data, branches) },
    select: { accountId: true, debit: true, credit: true, account: { select: { code: true, name: true, type: true } }, entry: { select: { currency: true } } }, take: 20001 });
  if (lines.length > 20000) return NextResponse.json({ error: "Report exceeds 20000 lines. Narrow the dates or branch." }, { status: 413 });
  const groups = new Map<string, { accountId: string; code: string; name: string; type: string; currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const line of lines) {
    const key = `${line.accountId}:${line.entry.currency}`;
    const group = groups.get(key) ?? { accountId: line.accountId, ...line.account, currency: line.entry.currency, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    group.debit = group.debit.plus(line.debit); group.credit = group.credit.plus(line.credit); groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a,b) => a.code.localeCompare(b.code) || a.currency.localeCompare(b.currency)).map((row) => {
    const balance = row.debit.minus(row.credit);
    return { ...row, debit: row.debit.toFixed(3), credit: row.credit.toFixed(3), debitBalance: balance.gt(0) ? balance.toFixed(3) : "0.000", creditBalance: balance.lt(0) ? balance.negated().toFixed(3) : "0.000" };
  });
  return NextResponse.json({ rows, lineCount: lines.length, scope: branches === null && !branchId ? "COMPANY" : "BRANCHES", from: parsed.data.from ?? null, to: parsed.data.to ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
