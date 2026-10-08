import {Prisma} from "@prisma/client";
import {canAccess} from "./access";
import {documentJournalNumber} from "./document-journal";
export class PosRefundConflict extends Error{}
export const posRefundNumber=(id:string)=>`SYSU-${BigInt(`0x${id.replaceAll("-","")}`).toString(36).toUpperCase().padStart(25,"0")}`;
export const posRefundOrder=(tx:Prisma.TransactionClient,tenantId:string,id:string)=>tx.posOrder.findFirst({where:{tenantId,id},include:{vat:true}});
export async function posRefundAllowed(userId:string,order:{tenantId:string;companyId:string;branchId:string},post=false){
 const scope={userId,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId};
 return (await Promise.all([canAccess({...scope,permission:"pos:read"}),canAccess({...scope,permission:"ledger:read"}),...(post?[canAccess({...scope,permission:"pos:manage"}),canAccess({...scope,permission:"ledger:post"})]:[])])).every(Boolean);
}
export async function posRefundState(tx:Prisma.TransactionClient,order:NonNullable<Awaited<ReturnType<typeof posRefundOrder>>>){
 const refunds=await tx.posRefund.findMany({where:{tenantId:order.tenantId,orderId:order.id},orderBy:[{createdAt:"desc"},{id:"asc"}],take:5001,include:{entry:{select:{id:true,number:true,entryDate:true,reversal:{select:{id:true,number:true,entryDate:true}}}}}});
 if(refunds.length>5000)throw new PosRefundConflict("Order exceeds 5000 refund records");
 const original=await tx.journalEntry.findFirst({where:{tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId,number:documentJournalNumber("pos",order.id)},include:{reversal:{select:{id:true,entryDate:true}},lines:{orderBy:{position:"asc"},include:{account:{select:{type:true}}}}}});
 const tax=order.vat?.taxAmount??new Prisma.Decimal(0),net=order.total.minus(tax);
 if(original&&(original.currency!==order.currency||!original.total.eq(order.total)||original.lines.length!==(tax.gt(0)?3:2)||original.lines[0]?.position!==0||original.lines[0]?.account.type!=="ASSET"||!original.lines[0].debit.eq(order.total)||!original.lines[0].credit.eq(0)||original.lines[1]?.position!==1||original.lines[1]?.account.type!=="REVENUE"||!original.lines[1].credit.eq(net)||!original.lines[1].debit.eq(0)||(tax.gt(0)&&(original.lines[2]?.position!==2||original.lines[2]?.accountId!==order.vat?.outputAccountId||!original.lines[2].credit.eq(tax)||!original.lines[2].debit.eq(0)))))throw new PosRefundConflict("Original POS accounts and amounts could not be verified");
 const latest=[order.paidAt?.toISOString().slice(0,10)??"",original?.entryDate.toISOString().slice(0,10)??"",...refunds.map(f=>(f.entry.reversal?.entryDate??f.entry.entryDate).toISOString().slice(0,10))].sort().at(-1)!;
 const active=refunds.find(f=>!f.entry.reversal);
 return {original,refunds,active,latest,net,tax,eligible:order.status==="PAID"&&Boolean(original&&!original.reversal)&&!active};
}
