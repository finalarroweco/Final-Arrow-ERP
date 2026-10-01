import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { ledgerScope, journalFilters, journalNumber, journalAmount, journalWhere, queryInput } from "@/lib/ledger";
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = journalFilters.safeParse(queryInput(params, ["tenantId", "companyId", "branchId", "from", "to"]));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? 0);
  if (!parsed.success || !page.success || params.getAll("page").length > 1) return NextResponse.json({ error: "Invalid journal filters" }, { status: 400 });
  const { tenantId, companyId, branchId } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "ledger:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await db.journalEntry.findMany({ where: journalWhere(parsed.data, branches), include: { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { position: "asc" } }, reversal: { select: { id: true, number: true } } }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ entries: entries.slice(0,50), nextPage: entries.length > 50 ? page.data+1 : null }, { headers: { "Cache-Control": "private, no-store" } });
}
const schema = ledgerScope.extend({ branchId: z.string().uuid().nullish(), number: journalNumber, entryDate: dueDate,
  description: z.string().trim().min(3).max(500), lines: z.array(z.object({ accountId: z.string().uuid(), debit: journalAmount, credit: journalAmount }).strict()).min(2).max(100) }).strict();
export async function POST(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid journal" }, { status: 400 });
  const { tenantId, companyId, branchId, entryDate, lines, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined, permission: "ledger:post" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let debit = new Prisma.Decimal(0), credit = new Prisma.Decimal(0);
  for (const line of lines) {
    const dr = new Prisma.Decimal(line.debit), cr = new Prisma.Decimal(line.credit);
    if (!(dr.gt(0) && cr.eq(0) || cr.gt(0) && dr.eq(0))) return NextResponse.json({ error: "Each line must have one positive debit or credit" }, { status: 400 });
    debit = debit.plus(dr); credit = credit.plus(cr);
  }
  if (!debit.eq(credit) || debit.gte("1000000000000000")) return NextResponse.json({ error: "Journal debits and credits must balance within the supported amount" }, { status: 400 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { baseCurrency: true } });
  if (!company || (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))) return NextResponse.json({ error: "Company or branch not found" }, { status: 404 });
  const ids = [...new Set(lines.map((line) => line.accountId))];
  if (await db.ledgerAccount.count({ where: { tenantId, companyId, id: { in: ids } } }) !== ids.length) return NextResponse.json({ error: "Account not found in this company" }, { status: 400 });
  try {
    const entry = await db.$transaction(async (tx) => {
      const entry = await tx.journalEntry.create({ data: { tenantId, companyId, branchId: branchId ?? null, ...data, entryDate: new Date(`${entryDate}T00:00:00Z`), currency: company.baseCurrency, total: debit, createdBy: actor.id,
        lines: { create: lines.map((line, position) => ({ ...line, tenantId, companyId, position })) } }, include: { lines: true } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "journal.posted", entity: "JournalEntry", entityId: entry.id } });
      return entry;
    }); return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Journal number already in use" }, { status: 409 });
    throw error;
  }
}
