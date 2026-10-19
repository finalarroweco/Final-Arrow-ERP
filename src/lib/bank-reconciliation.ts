import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {canAccess} from "./access";
import {dueDate} from "./date";
export class BankError extends Error{constructor(message:string,public status=409){super(message);}}
export const bankScope=z.object({tenantId:z.string().uuid(),companyId:z.string().uuid()});
const signed=z.string().regex(/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/);
const reference=z.string().trim().min(1).max(120).refine(s=>!/[\u0000-\u001f]/u.test(s));
export const bankStatementInput=bankScope.extend({requestId:z.string().uuid(),accountId:z.string().uuid(),reference:reference.refine(s=>s.length>=3),from:dueDate,to:dueDate,opening:signed,closing:signed,lines:z.array(z.object({bookingDate:dueDate,reference,amount:signed}).strict()).max(500)}).strict().refine(s=>s.from<=s.to&&(Date.parse(s.to)-Date.parse(s.from))/86400000<366);
export async function bankAllowed(userId:string,tenantId:string,companyId:string,write=false){return (await Promise.all([canAccess({userId,tenantId,companyId,permission:"ledger:read"}),...(write?[canAccess({userId,tenantId,companyId,permission:"ledger:post"})]:[])])).every(Boolean);}
export async function lockBankAccount(tx:Prisma.TransactionClient,tenantId:string,companyId:string,accountId:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "LedgerAccount" WHERE id=${accountId}::uuid AND "tenantId"=${tenantId}::uuid AND "companyId"=${companyId}::uuid AND type='ASSET' FOR UPDATE`;
 if(!rows.length)throw new BankError("Choose a bank asset account in this company",404);
}
export function normalizedStatement(s:z.infer<typeof bankStatementInput>){
 const data={...s,opening:new Prisma.Decimal(s.opening).toFixed(3),closing:new Prisma.Decimal(s.closing).toFixed(3),lines:s.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};
 if(data.lines.some(l=>new Prisma.Decimal(l.amount).eq(0)||l.bookingDate<data.from||l.bookingDate>data.to))throw new BankError("Each movement must be nonzero and inside the statement dates",400);
 const calculated=data.lines.reduce((n,l)=>n.plus(l.amount),new Prisma.Decimal(data.opening));
 if(!calculated.eq(data.closing))throw new BankError("Opening balance plus signed movements must equal closing balance",400);
 return {...data,requestHash:createHash("sha256").update(JSON.stringify(data)).digest("hex")};
}
export async function reconciliation(tx:Prisma.TransactionClient,id:string,tenantId:string){
 const statement=await tx.bankStatement.findFirst({where:{id,tenantId},include:{account:{select:{id:true,code:true,name:true}},lines:{orderBy:{position:"asc"},include:{matches:{where:{cancelledAt:null},select:{id:true,journalLine:{select:{id:true,entry:{select:{id:true,number:true,entryDate:true}}}}}}}}}});
 if(!statement)throw new BankError("Statement not found",404);
 const book=await tx.journalLine.findMany({where:{tenantId,companyId:statement.companyId,accountId:statement.accountId,entry:{entryDate:{lte:statement.to}}},include:{entry:{select:{id:true,number:true,entryDate:true,currency:true,description:true}},bankMatches:{where:{cancelledAt:null,bankLine:{bookingDate:{lte:statement.to}}},select:{id:true}}},take:20001});
 if(book.length>20000)throw new BankError("Account exceeds 20000 historical book movements",413);
 if(book.some(l=>l.entry.currency!==statement.currency))throw new BankError("Account contains another currency; reconcile a separate bank account");
 const bookClosing=book.reduce((n,l)=>n.plus(l.debit).minus(l.credit),new Prisma.Decimal(0));
 const outstanding=book.filter(l=>!l.bankMatches.length).sort((a,b)=>a.entry.entryDate.getTime()-b.entry.entryDate.getTime()||a.id.localeCompare(b.id));
 if(outstanding.length>5000)throw new BankError("Account exceeds 5000 outstanding movements",413);
 const outstandingTotal=outstanding.reduce((n,l)=>n.plus(l.debit).minus(l.credit),new Prisma.Decimal(0));
 const pendingBank=await tx.bankStatementLine.count({where:{tenantId,companyId:statement.companyId,accountId:statement.accountId,bookingDate:{lte:statement.to},statement:{voidedAt:null},matches:{none:{cancelledAt:null}}}});
 const adjustedBank=new Prisma.Decimal(statement.closing).plus(outstandingTotal),difference=bookClosing.minus(adjustedBank);
 return {statement:{...statement,lines:statement.lines.map(l=>({...l,amount:l.amount.toFixed(3)}))},bookClosing:bookClosing.toFixed(3),outstandingTotal:outstandingTotal.toFixed(3),adjustedBank:adjustedBank.toFixed(3),difference:difference.toFixed(3),pendingBank,reconciled:!statement.voidedAt&&pendingBank===0&&difference.eq(0),outstanding:outstanding.map(l=>({id:l.id,amount:l.debit.minus(l.credit).toFixed(3),entry:l.entry}))};
}
