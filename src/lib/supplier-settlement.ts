import {Prisma} from "@prisma/client";
import {canAccess} from "./access";
import {documentJournalNumber} from "./document-journal";
export class SettlementConflict extends Error{}
export function settlementNumber(kind:"PAYMENT"|"REFUND",id:string){return `${kind==="PAYMENT"?"SYSD":"SYSC"}-${BigInt(`0x${id.replaceAll("-","")}`).toString(36).toUpperCase().padStart(25,"0")}`;}
export async function settlementReceipt(tx:Prisma.TransactionClient,tenantId:string,id:string){return tx.goodsReceipt.findFirst({where:{id,tenantId},include:{order:{select:{branchId:true,supplier:{select:{branchId:true}}}}}});}
export async function settlementAllowed(userId:string,receipt:NonNullable<Awaited<ReturnType<typeof settlementReceipt>>>,post=false){
 const scope={userId,tenantId:receipt.tenantId,companyId:receipt.companyId};
 return (await Promise.all([canAccess({...scope,branchId:receipt.order.branchId??undefined,permission:"purchase-order:read"}),canAccess({...scope,branchId:receipt.order.supplier.branchId??undefined,permission:"supplier:read"}),canAccess({...scope,branchId:receipt.branchId,permission:"inventory-stock:read"}),canAccess({...scope,branchId:receipt.branchId,permission:"ledger:read"}),...(post?[canAccess({...scope,branchId:receipt.branchId,permission:"ledger:post"})]:[])])).every(Boolean);
}
export async function receiptSettlementState(tx:Prisma.TransactionClient,receipt:NonNullable<Awaited<ReturnType<typeof settlementReceipt>>>){
 const {tenantId,companyId,id:receiptId}=receipt;
 const returns=await tx.goodsReturn.findMany({where:{tenantId,receiptId},select:{id:true},take:5001});
 const settlements=await tx.supplierSettlement.findMany({where:{tenantId,receiptId},orderBy:[{createdAt:"desc"},{id:"asc"}],take:5001,include:{entry:{select:{id:true,number:true,entryDate:true,currency:true,reversal:{select:{id:true,number:true}}}}}});
 if(returns.length>5000||settlements.length>5000)throw new SettlementConflict("Receipt exceeds 5000 return or settlement records");
 const number=documentJournalNumber("purchase-receipt",receiptId),numbers=[number,...returns.map(r=>documentJournalNumber("purchase-return",r.id)),...settlements.map(s=>s.entry.number)];
 const entries=await tx.journalEntry.findMany({where:{tenantId,companyId,branchId:receipt.branchId,OR:[{number:{in:numbers}},{original:{number:{in:numbers}}}]},include:{reversal:{select:{id:true}},lines:{include:{account:{select:{id:true,code:true,name:true,type:true}}}}}});
 const original=entries.find(e=>e.number===number);
 const payable=original?.lines.find(l=>l.position===1)?.account;
 if(original&&(original.lines.length!==2||payable?.type!=="LIABILITY"))throw new SettlementConflict("Original receipt payable could not be verified");
 const balance=entries.reduce((sum,e)=>sum.plus(e.lines.filter(l=>l.account.type==="LIABILITY").reduce((n,l)=>n.plus(l.credit).minus(l.debit),new Prisma.Decimal(0))),new Prisma.Decimal(0));
 const latest=entries.reduce((date,e)=>{const d=e.entryDate.toISOString().slice(0,10);return d>date?d:date;},receipt.createdAt.toISOString().slice(0,10));
 return {original:original?{id:original.id,number:original.number,currency:original.currency,reversed:!!original.reversal}:null,payable,balance,paymentAvailable:balance.gt(0)?balance:new Prisma.Decimal(0),refundAvailable:balance.lt(0)?balance.negated():new Prisma.Decimal(0),latest,settlements};
}
export async function settlementDependencies(tx:Prisma.TransactionClient,tenantId:string,receiptId:string){
 const rows=await tx.supplierSettlement.findMany({where:{tenantId,receiptId},include:{entry:{select:{entryDate:true,reversal:{select:{entryDate:true}}}}}});
 return {active:rows.some(s=>!s.entry.reversal),latest:rows.reduce((date,s)=>{const d=(s.entry.reversal?.entryDate??s.entry.entryDate).toISOString().slice(0,10);return d>date?d:date;},"")};
}
