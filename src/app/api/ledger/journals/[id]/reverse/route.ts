import { writableLedgerCompany, LedgerPeriodClosed, LedgerCompanyMissing } from "@/lib/ledger-period";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { journalNumber } from "@/lib/ledger";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await context.params;
  const parsed = z.object({ tenantId: z.string().uuid(), number: journalNumber, entryDate: dueDate, reason: z.string().trim().min(3).max(500) }).strict().safeParse(await request.json().catch(() => null));
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid reversal" }, { status: 400 });
  const original = await db.journalEntry.findFirst({ where: { id, tenantId: parsed.data.tenantId }, include: { lines: true } });
  if (!original) return NextResponse.json({ error: "Journal not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId: original.tenantId, companyId: original.companyId, branchId: original.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "ledger:read" })) || !(await canAccess({ ...scope, permission: "ledger:post" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (original.reversalOf || parsed.data.entryDate < original.entryDate.toISOString().slice(0,10)) return NextResponse.json({ error: "Cannot reverse a reversal or use an earlier date" }, { status: 409 });
  try {
    const entry = await db.$transaction(async (tx) => {
      await writableLedgerCompany(tx, original.tenantId, original.companyId, parsed.data.entryDate);
      const entry = await tx.journalEntry.create({ data: { tenantId: original.tenantId, companyId: original.companyId, branchId: original.branchId,
        number: parsed.data.number, entryDate: new Date(`${parsed.data.entryDate}T00:00:00Z`), description: parsed.data.reason,
        currency: original.currency, total: original.total, reversalOf: original.id, createdBy: actor.id,
        lines: { create: original.lines.map((line) => ({ accountId: line.accountId, position: line.position, debit: line.credit, credit: line.debit })) } } });
      await tx.auditLog.create({ data: { tenantId: original.tenantId, actorId: actor.id, action: "journal.reversed", entity: "JournalEntry", entityId: original.id, metadata: { reversalId: entry.id } } });
      return entry;
    }); return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof LedgerPeriodClosed) return NextResponse.json({ error: error.message, lockedThrough: error.lockedThrough }, { status: 409 });
    if (error instanceof LedgerCompanyMissing) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Journal already reversed or number already used" }, { status: 409 });
    throw error;
  }
}
