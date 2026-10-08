import {settlementInvoice,customerSettlementAllowed,invoiceSettlementState,customerSettlementDependencies,customerSettlementNumber} from "@/lib/customer-settlement";
import {settlementReceipt,settlementAllowed,settlementDependencies,settlementNumber,receiptSettlementState} from "@/lib/supplier-settlement";
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
      if (/^SYS[KF]-/.test(original.number)) {
        const saved=await tx.customerSettlement.findFirst({where:{tenantId:original.tenantId,entryId:original.id}});
        if(!saved||customerSettlementNumber(saved.kind as "COLLECTION"|"REFUND",saved.id)!==original.number)throw new PayrollReversalConflict("Customer settlement source could not be verified");
        await lockDocument(tx,"invoice",original.tenantId,saved.invoiceId);
        const invoice=await settlementInvoice(tx,original.tenantId,saved.invoiceId);
        if(!invoice||!(await customerSettlementAllowed(actor.id,invoice,true)))throw new PayrollReversalConflict("Invoice, order, customer and ledger permissions are required");
        const state=await invoiceSettlementState(tx,invoice);
        if(parsed.data.entryDate<state.latest)throw new PayrollReversalConflict("Correction cannot precede later invoice activity");
        const after=saved.kind==="COLLECTION"?state.collected.minus(saved.amount):state.collected.plus(saved.amount);
        if(after.lt(0)||after.gt(invoice.subtotal))throw new PayrollReversalConflict("Reverse dependent refunds or later collections first");
      }
      if (original.number.startsWith("SYSI-")) {
        const link=await tx.auditLog.findFirst({where:{tenantId:original.tenantId,entity:"Invoice",action:"invoice.ledger_posted",metadata:{path:["journalId"],equals:original.id}},select:{entityId:true}});
        if(!link?.entityId||!z.string().uuid().safeParse(link.entityId).success||documentJournalNumber("invoice",link.entityId)!==original.number)throw new PayrollReversalConflict("Invoice source could not be verified");
        await lockDocument(tx,"invoice",original.tenantId,link.entityId);
        const source=await settlementInvoice(tx,original.tenantId,link.entityId);
        if(!source||!(await customerSettlementAllowed(actor.id,source,true)))throw new PayrollReversalConflict("Invoice, order, customer and ledger permissions are required");
        const dependencies=await customerSettlementDependencies(tx,original.tenantId,link.entityId);
        if(dependencies.active)throw new PayrollReversalConflict("Reverse active customer settlements before the invoice journal");
        if(dependencies.latest&&parsed.data.entryDate<dependencies.latest)throw new PayrollReversalConflict("Invoice reversal cannot precede settlement corrections");
      }
      if (/^SYS[DC]-/.test(original.number)) {
        const saved=await tx.supplierSettlement.findFirst({where:{tenantId:original.tenantId,entryId:original.id}});
        if(!saved||settlementNumber(saved.kind as "PAYMENT"|"REFUND",saved.id)!==original.number)throw new PayrollReversalConflict("Settlement source link could not be verified");
        await lockDocument(tx,"purchase-receipt",original.tenantId,saved.receiptId);
        const receipt=await settlementReceipt(tx,original.tenantId,saved.receiptId);
        if(!receipt||!(await settlementAllowed(actor.id,receipt,true)))throw new PayrollReversalConflict("Supplier, source-order and receiving-stock permissions are required");
        if(parsed.data.entryDate<(await receiptSettlementState(tx,receipt)).latest)throw new PayrollReversalConflict("Settlement reversal date cannot precede later receipt activity");
      }
      if (/^SYS[GT]-/.test(original.number)) {
        const link=purchaseJournalSource(original.number);
        if(!link||documentJournalNumber(link.kind,link.id)!==original.number)throw new PayrollReversalConflict("Purchase source link could not be verified");
        await lockDocument(tx,link.kind,original.tenantId,link.id);
        const source=await purchaseDocument(tx,link.kind,original.tenantId,link.id);
        if(!source||source.companyId!==original.companyId||source.branchId!==original.branchId)throw new PayrollReversalConflict("Purchase source scope could not be verified");
        const rights=await Promise.all([canAccess({...scope,branchId:source.orderBranchId??undefined,permission:"purchase-order:read"}),canAccess({...scope,branchId:source.branchId,permission:"inventory-stock:read"})]);
        if(!rights.every(Boolean))throw new PayrollReversalConflict("Purchase and receiving-stock read permissions are required");
        if(link.kind==="purchase-receipt"){
          const payments=await settlementDependencies(tx,original.tenantId,source.receiptId);
          if(payments.active)throw new PayrollReversalConflict("Reverse active supplier settlements before the receipt journal");
          if(payments.latest&&parsed.data.entryDate<payments.latest)throw new PayrollReversalConflict("Receipt reversal date cannot precede supplier settlement corrections");
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
    },{timeout:15000,maxWait:10000}); return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof PayrollReversalConflict) return NextResponse.json({error:error.message},{status:409});
    if (error instanceof LedgerPeriodClosed) return NextResponse.json({ error: error.message, lockedThrough: error.lockedThrough }, { status: 409 });
    if (error instanceof LedgerCompanyMissing) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Journal already reversed or number already used" }, { status: 409 });
    if (error instanceof Error && "code" in error && error.code === "P2004") return NextResponse.json({error:"Correction conflicts with the invoice balance or source activity"},{status:409});
    throw error;
  }
}

