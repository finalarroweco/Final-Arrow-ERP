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
const pathSchema = z.object({ kind: z.enum(["invoice", "expense", "pos"]), id: uuid });
const bodySchema = z.object({ tenantId: uuid, entryDate: dueDate, debitAccountId: uuid, creditAccountId: uuid }).strict();
type Context = { params: Promise<{ kind: string; id: string }> };
class PostingConflict extends Error {}
async function source(kind: DocumentKind, tenantId: string, id: string, client: Prisma.TransactionClient = db) {
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
async function permitted(userId: string, kind: DocumentKind, tenantId: string, row: { companyId: string; branchId: string | null }, post: boolean) {
  const scope = { userId, tenantId, companyId: row.companyId, branchId: row.branchId ?? undefined };
  const checks = await Promise.all([canAccess({ ...scope, permission: `${kind}:read` }),
    canAccess({ ...scope, permission: "ledger:read" }), ...(post ? [canAccess({ ...scope, permission: "ledger:post" })] : [])]);
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
  return NextResponse.json({entry},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request, context: Context) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({error:"Unauthenticated"},{status:401});
  const path = pathSchema.safeParse(await context.params);
  const body = bodySchema.safeParse(await request.json().catch(()=>null));
  if (!path.success || !body.success) return NextResponse.json({error:"Invalid document posting"},{status:400});
  const {kind,id} = path.data;
  const {tenantId,entryDate,debitAccountId,creditAccountId} = body.data;
  const initial = await source(kind,tenantId,id);
  if (!initial) return NextResponse.json({error:"Document not found"},{status:404});
  if (!(await permitted(actor.id,kind,tenantId,initial,true))) return NextResponse.json({error:"Forbidden"},{status:403});
  try {
    const entry = await db.$transaction(async tx => {
      await lockDocument(tx,kind,tenantId,id);
      const row = await source(kind,tenantId,id,tx);
      if (!row?.eligible || !row.date) throw new PostingConflict("Issue the invoice, approve the expense or record POS payment before ledger posting");
      if (entryDate < row.date) throw new PostingConflict("Journal date cannot precede the document date");
      if (await documentJournal(tx,kind,tenantId,row.companyId,id)) throw new PostingConflict("Document already has a ledger journal, including if reversed");
      const company = await writableLedgerCompany(tx,tenantId,row.companyId,entryDate);
      if (row.currency !== company.baseCurrency) throw new PostingConflict("Document currency differs from company currency");
      if (!row.amount.gt(0) || row.amount.gte("1000000000000000")) throw new PostingConflict("Document amount is outside the supported positive range");
      const accounts = await tx.ledgerAccount.findMany({where:{tenantId,companyId:row.companyId,id:{in:[debitAccountId,creditAccountId]}}});
      const debit = accounts.find(a=>a.id===debitAccountId), credit = accounts.find(a=>a.id===creditAccountId);
      if (debitAccountId === creditAccountId || !debit || !credit ||
        (kind !== "expense" ? debit.type !== "ASSET" || credit.type !== "REVENUE" :
          debit.type !== "EXPENSE" || !["ASSET","LIABILITY"].includes(credit.type)))
        throw new PostingConflict("Invoice/POS requires asset debit / revenue credit; expense requires expense debit / asset or liability credit in the same company");
      const journal = await tx.journalEntry.create({data:{tenantId,companyId:row.companyId,branchId:row.branchId,
        number:documentJournalNumber(kind,id),entryDate:new Date(`${entryDate}T00:00:00Z`),
        description:`${kind === "invoice" ? "Invoice" : kind === "expense" ? "Expense" : "POS"} ${row.number}`,
        currency:row.currency,total:row.amount,createdBy:actor.id,lines:{create:[
          {position:0,accountId:debit.id,debit:row.amount,credit:new Prisma.Decimal(0)},
          {position:1,accountId:credit.id,debit:new Prisma.Decimal(0),credit:row.amount},
        ]}},select:{id:true,number:true}});
      await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:`${kind}.ledger_posted`,
        entity:kind === "invoice" ? "Invoice" : kind === "expense" ? "Expense" : "PosOrder",entityId:id,metadata:{journalId:journal.id,journalNumber:journal.number,amount:row.amount.toString(),currency:row.currency}}});
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
