import {Prisma} from "@prisma/client";
import {canAccess} from "./access";
import {documentJournalNumber} from "./document-journal";
export class CustomerSettlementConflict extends Error {}
export function customerSettlementNumber(kind:"COLLECTION"|"REFUND",id:string){return `${kind==="COLLECTION"?"SYSK":"SYSF"}-${BigInt(`0x${id.replaceAll("-","")}`).toString(36).toUpperCase().padStart(25,"0")}`;}
export async function settlementInvoice(tx:Prisma.TransactionClient,tenantId:string,id:string){return tx.invoice.findFirst({where:{id,tenantId},include:{order:{select:{branchId:true}},customer:{select:{branchId:true}}}});}
export async function customerSettlementAllowed(userId:string,invoice:NonNullable<Awaited<ReturnType<typeof settlementInvoice>>>,post=false){
 const scope={userId,tenantId:invoice.tenantId,companyId:invoice.companyId};
 return (await Promise.all([canAccess({...scope,branchId:invoice.branchId??undefined,permission:"invoice:read"}),canAccess({...scope,branchId:invoice.order.branchId??undefined,permission:"order:read"}),canAccess({...scope,branchId:invoice.customer.branchId??undefined,permission:"customer:read"}),canAccess({...scope,branchId:invoice.branchId??undefined,permission:"ledger:read"}),...(post?[canAccess({...scope,branchId:invoice.branchId??undefined,permission:"ledger:post"})]:[])])).every(Boolean);
}
export async function invoiceSettlementState(tx:Prisma.TransactionClient,invoice:NonNullable<Awaited<ReturnType<typeof settlementInvoice>>>){
 const {tenantId,companyId,id:invoiceId}=invoice;
 const settlements=await tx.customerSettlement.findMany({where:{tenantId,invoiceId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:5001,include:{entry:{select:{id:true,number:true,entryDate:true,currency:true,reversal:{select:{id:true,number:true}}}}}});
 if(settlements.length>5000)throw new CustomerSettlementConflict("Invoice exceeds 5000 settlement records");
 const number=documentJournalNumber("invoice",invoiceId),numbers=[number,...settlements.map(s=>s.entry.number)];
 const entries=await tx.journalEntry.findMany({where:{tenantId,companyId,branchId:invoice.branchId,OR:[{number:{in:numbers}},{original:{number:{in:numbers}}}]},include:{reversal:{select:{id:true}},lines:{include:{account:{select:{id:true,code:true,name:true,type:true}}}}}});
 const original=entries.find(e=>e.number===number),receivable=original?.lines.find(l=>l.position===0)?.account;
 if(original&&(original.lines.length!==2||receivable?.type!=="ASSET"||!original.total.eq(invoice.subtotal)))throw new CustomerSettlementConflict("Original invoice receivable could not be verified");
 const collected=settlements.filter(s=>!s.entry.reversal).reduce((sum,s)=>s.kind==="COLLECTION"?sum.plus(s.amount):sum.minus(s.amount),new Prisma.Decimal(0));
 const balance=original&&!original.reversal?original.total.minus(collected):new Prisma.Decimal(0);
 const latest=entries.reduce((date,e)=>{const d=e.entryDate.toISOString().slice(0,10);return d>date?d:date;},(invoice.issuedAt??invoice.createdAt).toISOString().slice(0,10));
 return {original:original?{id:original.id,number:original.number,currency:original.currency,reversed:!!original.reversal}:null,receivable,balance,collected,paymentAvailable:balance.gt(0)?balance:new Prisma.Decimal(0),refundAvailable:collected.gt(0)?collected:new Prisma.Decimal(0),latest,settlements};
}
export async function customerSettlementDependencies(tx:Prisma.TransactionClient,tenantId:string,invoiceId:string){
 const rows=await tx.customerSettlement.findMany({where:{tenantId,invoiceId},include:{entry:{select:{entryDate:true,reversal:{select:{entryDate:true}}}}}});
 return {active:rows.some(s=>!s.entry.reversal),latest:rows.reduce((date,s)=>{const d=(s.entry.reversal?.entryDate??s.entry.entryDate).toISOString().slice(0,10);return d>date?d:date;},"")};
}
