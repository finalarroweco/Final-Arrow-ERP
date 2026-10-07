import {purchaseDocument,isPurchaseDocument} from "@/lib/purchase-ledger";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { documentJournal, documentJournalNumber, lockDocument, type DocumentKind } from "@/lib/document-journal";
import { writableLedgerCompany, LedgerPeriodClosed, LedgerCompanyMissing } from "@/lib/ledger-period";
const uuid = z.string().uuid();
const pathSchema = z.object({ kind: z.enum(["invoice", "expense", "pos", "payroll", "payroll-payment", "purchase-receipt", "purchase-return"]), id: uuid });
const bodySchema = z.object({ tenantId: uuid, entryDate: dueDate, debitAccountId: uuid, creditAccountId: uuid, deductionAccountId: uuid.optional() }).strict();
type Context = { params: Promise<{ kind: string; id: string }> };
class PostingConflict extends Error {}
async function source(kind: DocumentKind, tenantId: string, id: string, client: Prisma.TransactionClient = db) {
  if(isPurchaseDocument(kind))return purchaseDocument(client,kind,tenantId,id);
  if (kind === "payroll" || kind === "payroll-payment") {
    const row = await client.payrollEntry.findUnique({where:{tenantId_id:{tenantId,id}}});
    return row && {...row, amount:kind === "payroll" ? row.baseSalary.plus(row.allowances) : row.netPay,
      number:`${row.employeeCode} ${row.period.toISOString().slice(0,7)}`,
      date:kind === "payroll" ? row.period.toISOString().slice(0,10) : row.paidAt?.toISOString().slice(0,10),
      eligible:kind === "payroll" ? ["APPROVED","PAID"].includes(row.status) : row.status === "PAID"};
  }
  if (kind === "invoice") {
    const row = await client.invoice.findUnique({ where: { tenantId_id: { tenantId, id } } });
    return row && { ...row, amount: row.subtotal, date: row.issuedAt?.toISOString().slice(0,10), eligible: row.status === "ISSUED" };
  }
  if (kind === "pos") {
    const row = await client.posOrder.findFirst({where:{tenantId,id}});
    return row && {...row,amount:row.total,date:row.paidAt?.toISOString().slice(0,10),eligible:row.status === "PAID"};
  }
  const row = await client.expense.findUnique({ where: { tenantId_id: { tenantId, id } } });
  return row && { ...row, date: row.expenseDate.toISOString().slice(0,10), eligible: row.status === "POSTED" };
}
async function permitted(userId: string, kind: DocumentKind, tenantId: string, row: { companyId: string; branchId: string | null; orderBranchId?:string|null }, post: boolean) {
  const scope = { userId, tenantId, companyId: row.companyId, branchId: row.branchId ?? undefined };
  const checks = await Promise.all([canAccess({ ...scope, ...(isPurchaseDocument(kind)?{branchId:row.orderBranchId??undefined}:{}), permission: `${isPurchaseDocument(kind) ? "purchase-order" : kind === "payroll-payment" ? "payroll" : kind}:read` }),
    canAccess({ ...scope, permission: "ledger:read" }), ...(isPurchaseDocument(kind)?[canAccess({...scope,permission:"inventory-stock:read"})]:[]), ...(post ? [canAccess({ ...scope, permission: "ledger:post" })] : [])]);
  return checks.every(Boolean);
}
export async function GET(request: Request, context: Context) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({error:"Unauthenticated"},{status:401});
  const path = pathSchema.safeParse(await context.params);
  const query = new URL(request.url).searchParams;
  const tenant = uuid.safeParse(query.get("tenantId"));
  if (!path.success || !tenant.success || query.getAll("tenantId").length !== 1) return NextResponse.json({error:"Invalid document"},{status:400});
  const row = await source(path.data.kind, tenant.data, path.data.id);
  if (!row) return NextResponse.json({error:"Document not found"},{status:404});
  if (!(await permitted(actor.id,path.data.kind,tenant.data,row,false))) return NextResponse.json({error:"Forbidden"},{status:403});
  const entry = await documentJournal(db,path.data.kind,tenant.data,row.companyId,path.data.id);
  let purchaseSetup=null;
  if(path.data.kind==="purchase-return"&&"receiptId" in row){
    const original=await documentJournal(db,"purchase-receipt",tenant.data,row.companyId,row.receiptId);
    if(original&&!original.reversal){
      const lines=await db.journalLine.findMany({where:{entryId:original.id},include:{account:{select:{id:true,code:true,name:true,type:true}}},orderBy:{position:"asc"}});
      if(lines.length===2)purchaseSetup={entry:original,debitAccountId:lines[1].accountId,creditAccountId:lines[0].accountId,accounts:lines.map(l=>l.account)};
    }
  }
  return NextResponse.json({entry,...(isPurchaseDocument(path.data.kind)?{purchaseSetup,amount:row.amount.toString(),currency:row.currency}:{})},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request, context: Context) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({error:"Unauthenticated"},{status:401});
  const path = pathSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(()=>null));
  if (!path.success || !body.success) return NextResponse.json({error:"Invalid document posting"},{status:400});
  const {kind,id} = path.data;
  const {tenantId,entryDate,debitAccountId,creditAccountId,deductionAccountId} = body.data;
  if (kind !== "payroll" && deductionAccountId) return NextResponse.json({error:"Deduction account is only supported for payroll"},{status:400});
  const initial = await source(kind,tenantId,id);
  if (!initial) return NextResponse.json({error:"Document not found"},{status:404});
  if (!(await permitted(actor.id,kind,tenantId,initial,true))) return NextResponse.json({error:"Forbidden"},{status:403});
  try {
    const entry = await db.$transaction(async tx => {
      await lockDocument(tx,kind,tenantId,id);
      const row = await source(kind,tenantId,id,tx);
      if (!row?.eligible || !row.date) throw new PostingConflict("Document is unavailable for posting: check its status and any reversed receipt stock movements");
      if (entryDate < row.date) throw new PostingConflict("Journal date cannot precede the document date");
      if (await documentJournal(tx,kind,tenantId,row.companyId,id)) throw new PostingConflict("Document already has a ledger journal, including if reversed");
      const company = await writableLedgerCompany(tx,tenantId,row.companyId,entryDate);
      if (row.currency !== company.baseCurrency) throw new PostingConflict("Document currency differs from company currency");
      if (!row.amount.gt(0) || row.amount.gte("1000000000000000")) throw new PostingConflict("Document amount is outside the supported positive range");
      const accounts = await tx.ledgerAccount.findMany({where:{tenantId,companyId:row.companyId,id:{in:[debitAccountId,creditAccountId,...(deductionAccountId?[deductionAccountId]:[])]}}});
      const debit = accounts.find(a=>a.id===debitAccountId), credit = accounts.find(a=>a.id===creditAccountId);
      if(!debit||!credit||debit.id===credit.id)throw new PostingConflict("Choose two different accounts in the document company");
      if(isPurchaseDocument(kind)){
        if(!debit||!credit||debit.id===credit.id||
          (kind==="purchase-receipt"? !["ASSET","EXPENSE"].includes(debit.type)||credit.type!=="LIABILITY":debit.type!=="LIABILITY"||!["ASSET","EXPENSE"].includes(credit.type)))
          throw new PostingConflict("Purchases require asset/expense debit and supplier liability credit; returns use their opposite accounts");
        if(kind==="purchase-return"&&"receiptId" in row){
          const original=await documentJournal(tx,"purchase-receipt",tenantId,row.companyId,row.receiptId);
          if(!original||original.reversal)throw new PostingConflict("Post an active original receipt journal before its return credit");
          if(entryDate<original.entryDate.toISOString().slice(0,10))throw new PostingConflict("Return journal date cannot precede its receipt journal");
          const originalLines=await tx.journalLine.findMany({where:{entryId:original.id},orderBy:{position:"asc"}});
          const originalSource=await purchaseDocument(tx,"purchase-receipt",tenantId,row.receiptId);
          if(originalLines.length!==2||originalLines[0].accountId!==credit.id||originalLines[1].accountId!==debit.id||!originalLines[0].debit.eq(original.total)||!originalLines[1].credit.eq(original.total)||!originalSource?.amount.eq(original.total))
            throw new PostingConflict("Use the same supplier liability and purchase account as the original receipt journal");
        }
      }
      if (!isPurchaseDocument(kind) && (debitAccountId === creditAccountId || !debit || !credit ||
        (kind === "payroll-payment" ? debit.type !== "LIABILITY" || credit.type !== "ASSET" : kind === "payroll" ? debit.type !== "EXPENSE" || credit.type !== "LIABILITY" : kind !== "expense" ? debit.type !== "ASSET" || credit.type !== "REVENUE" :
          debit.type !== "EXPENSE" || !["ASSET","LIABILITY"].includes(credit.type))))
        throw new PostingConflict("Invalid document account types: payroll requires expense debit / payroll liability credit in the same company");
      if (kind === "payroll-payment") {
        const accrual=await documentJournal(tx,"payroll",tenantId,row.companyId,id);
        if (!accrual || accrual.reversal) throw new PostingConflict("Post an active payroll accrual before settling payment");
        if (entryDate < accrual.entryDate.toISOString().slice(0,10)) throw new PostingConflict("Payment journal date cannot precede its accrual");
        const payable=await tx.journalLine.findUnique({where:{entryId_position:{entryId:accrual.id,position:1}}});
        if (!payable || payable.accountId !== debit.id || !payable.credit.eq(row.amount))
          throw new PostingConflict("Debit the same net-pay liability used in the payroll accrual");
      }
      const zero = new Prisma.Decimal(0);
      const lines = [{position:0,accountId:debit.id,debit:row.amount,credit:zero}];
      if (kind === "payroll" && "deductions" in row) {
        if (!row.netPay.plus(row.deductions).eq(row.amount)) throw new PostingConflict("Payroll amounts are inconsistent");
        if (row.netPay.gt(0)) lines.push({position:lines.length,accountId:credit.id,debit:zero,credit:row.netPay});
        if (row.deductions.gt(0)) {
          const deduction=accounts.find(a=>a.id===deductionAccountId);
          if (!deduction || !["LIABILITY","EXPENSE"].includes(deduction.type) || [debit.id,credit.id].includes(deduction.id))
            throw new PostingConflict("Choose a separate deduction liability or expense-offset account in this company");
          lines.push({position:lines.length,accountId:deduction.id,debit:zero,credit:row.deductions});
        } else if (deductionAccountId) throw new PostingConflict("No payroll deductions to post");
      } else lines.push({position:1,accountId:credit.id,debit:zero,credit:row.amount});
      const journal = await tx.journalEntry.create({data:{tenantId,companyId:row.companyId,branchId:row.branchId,
        number:documentJournalNumber(kind,id),entryDate:new Date(`${entryDate}T00:00:00Z`),
        description:`${kind === "purchase-receipt" ? "Purchase receipt" : kind === "purchase-return" ? "Purchase return credit" : kind === "invoice" ? "Invoice" : kind === "expense" ? "Expense" : kind === "payroll" ? "Payroll accrual" : kind === "payroll-payment" ? "Payroll payment" : "POS"} ${row.number}`,
        currency:row.currency,total:row.amount,createdBy:actor.id,lines:{create:lines}},select:{id:true,number:true}});
      await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:`${kind}.ledger_posted`,
        entity:kind === "purchase-receipt" ? "GoodsReceipt" : kind === "purchase-return" ? "GoodsReturn" : kind === "invoice" ? "Invoice" : kind === "expense" ? "Expense" : ["payroll","payroll-payment"].includes(kind) ? "PayrollEntry" : "PosOrder",entityId:id,metadata:{journalId:journal.id,journalNumber:journal.number,amount:row.amount.toString(),currency:row.currency}}});
      return journal;
    },{timeout:15000,maxWait:10000});
    return NextResponse.json({entry},{status:201});
  } catch(error) {
    if (error instanceof LedgerPeriodClosed) return NextResponse.json({error:error.message,lockedThrough:error.lockedThrough},{status:409});
    if (error instanceof PostingConflict) return NextResponse.json({error:error.message},{status:409});
    if (error instanceof LedgerCompanyMissing) return NextResponse.json({error:"Company not found"},{status:404});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({error:"Document already posted"},{status:409});
    throw error;
  }
}

