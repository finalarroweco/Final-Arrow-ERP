import {purchaseDocument,purchaseJournalSource,returnJournalDependencies} from "@/lib/purchase-ledger";
import { writableLedgerCompany, LedgerPeriodClosed, LedgerCompanyMissing } from "@/lib/ledger-period";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { journalNumber } from "@/lib/ledger";
import { documentJournal, documentJournalNumber, lockDocument } from "@/lib/document-journal";
class PayrollReversalConflict extends Error {}
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
      if (/^SYS[GT]-/.test(original.number)) {
        const link=purchaseJournalSource(original.number);
        if(!link||documentJournalNumber(link.kind,link.id)!==original.number)throw new PayrollReversalConflict("Purchase source link could not be verified");
        await lockDocument(tx,link.kind,original.tenantId,link.id);
        const source=await purchaseDocument(tx,link.kind,original.tenantId,link.id);
        if(!source||source.companyId!==original.companyId||source.branchId!==original.branchId)throw new PayrollReversalConflict("Purchase source scope could not be verified");
        const rights=await Promise.all([canAccess({...scope,branchId:source.orderBranchId??undefined,permission:"purchase-order:read"}),canAccess({...scope,branchId:source.branchId,permission:"inventory-stock:read"})]);
        if(!rights.every(Boolean))throw new PayrollReversalConflict("Purchase and receiving-stock read permissions are required");
        if(link.kind==="purchase-receipt"){
          const dependencies=await returnJournalDependencies(tx,original.tenantId,original.companyId,source.receiptId);
          if(dependencies.active)throw new PayrollReversalConflict("Reverse active return-credit journals before the original receipt journal");
          if(dependencies.latestDate&&parsed.data.entryDate<dependencies.latestDate)throw new PayrollReversalConflict("Receipt reversal date cannot precede return-credit corrections");
        }
      }
      if (/^SYS[RW]-/.test(original.number)) {
        const link=await tx.auditLog.findFirst({where:{tenantId:original.tenantId,entity:"PayrollEntry",
          action:{in:["payroll.ledger_posted","payroll-payment.ledger_posted"]},metadata:{path:["journalId"],equals:original.id}},select:{entityId:true}});
        const kind=original.number.startsWith("SYSR-") ? "payroll" : "payroll-payment";
        if (!link?.entityId || !z.string().uuid().safeParse(link.entityId).success || documentJournalNumber(kind,link.entityId) !== original.number) throw new PayrollReversalConflict("Payroll source link could not be verified");
        // Same source lock as payment/accrual posting prevents concurrent settlement
        // from surviving a reversed accrual. Always lock source before company.
        await lockDocument(tx,"payroll",original.tenantId,link.entityId);
        if (kind === "payroll") {
          const payment=await documentJournal(tx,"payroll-payment",original.tenantId,original.companyId,link.entityId);
          if (payment && !payment.reversal) throw new PayrollReversalConflict("Reverse the payroll payment journal before reversing its accrual");
        }
      }
      await writableLedgerCompany(tx, original.tenantId, original.companyId, parsed.data.entryDate);
      const entry = await tx.journalEntry.create({ data: { tenantId: original.tenantId, companyId: original.companyId, branchId: original.branchId,
        number: parsed.data.number, entryDate: new Date(`${parsed.data.entryDate}T00:00:00Z`), description: parsed.data.reason,
        currency: original.currency, total: original.total, reversalOf: original.id, createdBy: actor.id,
        lines: { create: original.lines.map((line) => ({ accountId: line.accountId, position: line.position, debit: line.credit, credit: line.debit })) } } });
      await tx.auditLog.create({ data: { tenantId: original.tenantId, actorId: actor.id, action: "journal.reversed", entity: "JournalEntry", entityId: original.id, metadata: { reversalId: entry.id } } });
      return entry;
    }); return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof PayrollReversalConflict) return NextResponse.json({error:error.message},{status:409});
    if (error instanceof LedgerPeriodClosed) return NextResponse.json({ error: error.message, lockedThrough: error.lockedThrough }, { status: 409 });
    if (error instanceof LedgerCompanyMissing) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Journal already reversed or number already used" }, { status: 409 });
    throw error;
  }
}

