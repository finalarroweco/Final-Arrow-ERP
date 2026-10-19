import {Prisma} from "@prisma/client";
import {canAccess} from "./access";
import {documentJournalNumber} from "./document-journal";
export class PosRefundConflict extends Error{}
export const posRefundNumber=(id:string)=>`SYSU-${BigInt(`0x${id.replaceAll("-","")}`).toString(36).toUpperCase().padStart(25,"0")}`;
export const posRefundOrder=(tx:Prisma.TransactionClient,tenantId:string,id:string)=>tx.posOrder.findFirst({where:{tenantId,id},include:{vat:true,lines:{orderBy:{position:"asc"}}}});
export async function posRefundAllowed(userId:string,order:{tenantId:string;companyId:string;branchId:string},post=false){
 const scope={userId,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId};
 return (await Promise.all([canAccess({...scope,permission:"pos:read"}),canAccess({...scope,permission:"ledger:read"}),...(post?[canAccess({...scope,permission:"pos:manage"}),canAccess({...scope,permission:"ledger:post"})]:[])])).every(Boolean);
}
export async function posRefundState(tx:Prisma.TransactionClient,order:NonNullable<Awaited<ReturnType<typeof posRefundOrder>>>){
 const refunds=await tx.posRefund.findMany({where:{tenantId:order.tenantId,orderId:order.id},orderBy:[{createdAt:"desc"},{id:"asc"}],take:5001,include:{lines:true,entry:{select:{id:true,number:true,entryDate:true,reversal:{select:{id:true,number:true,entryDate:true}}}}}});
 if(refunds.length>5000)throw new PosRefundConflict("Order exceeds 5000 refund records");
 const original=await tx.journalEntry.findFirst({where:{tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId,number:documentJournalNumber("pos",order.id)},include:{reversal:{select:{id:true,entryDate:true}},lines:{orderBy:{position:"asc"},include:{account:{select:{type:true}}}}}});
 const tax=order.vat?.taxAmount??new Prisma.Decimal(0),net=order.total.minus(tax);
 if(original&&(original.currency!==order.currency||!original.total.eq(order.total)||original.lines.length!==(tax.gt(0)?3:2)||original.lines[0]?.position!==0||original.lines[0]?.account.type!=="ASSET"||!original.lines[0].debit.eq(order.total)||!original.lines[0].credit.eq(0)||original.lines[1]?.position!==1||original.lines[1]?.account.type!=="REVENUE"||!original.lines[1].credit.eq(net)||!original.lines[1].debit.eq(0)||(tax.gt(0)&&(original.lines[2]?.position!==2||original.lines[2]?.accountId!==order.vat?.outputAccountId||!original.lines[2].credit.eq(tax)||!original.lines[2].debit.eq(0)))))throw new PosRefundConflict("Original POS accounts and amounts could not be verified");
 const latest=[order.paidAt?.toISOString().slice(0,10)??"",original?.entryDate.toISOString().slice(0,10)??"",...refunds.map(f=>(f.entry.reversal?.entryDate??f.entry.entryDate).toISOString().slice(0,10))].sort().at(-1)!;
 const active=refunds.find(f=>!f.entry.reversal);
 const activeRefunds=refunds.filter(f=>!f.entry.reversal),fullActive=activeRefunds.some(f=>f.kind==="FULL");
 const details=(order.vat?.details??[]) as {position:number;tax:string;treatment:string}[];
 const usedByLine=new Map<string,{quantity:number;tax:Prisma.Decimal}>();for(const f of activeRefunds)for(const line of f.lines){const used=usedByLine.get(line.orderLineId)??{quantity:0,tax:new Prisma.Decimal(0)};used.quantity+=line.quantity;used.tax=used.tax.plus(line.taxAmount);usedByLine.set(line.orderLineId,used);}
 const remainingLines=order.lines.map(l=>{const used=usedByLine.get(l.id);const quantity=fullActive?0:l.quantity-(used?.quantity??0);const saved=details.find(d=>d.position===l.position);const tax=fullActive?new Prisma.Decimal(0):new Prisma.Decimal(saved?.tax??0).minus(used?.tax??0);if(quantity<0||tax.lt(0))throw new PosRefundConflict("Refund history exceeds original quantity or VAT");return{orderLineId:l.id,itemName:l.itemName,soldQuantity:l.quantity,remainingQuantity:quantity,unitPrice:l.unitPrice.toFixed(3),remainingTax:tax.toFixed(3),treatment:saved?.treatment??"NO_VAT"};});
 return {original,refunds,active,latest,net,tax,remainingLines,partialEligible:order.status==="PAID"&&Boolean(original&&!original.reversal)&&!fullActive&&remainingLines.some(l=>l.remainingQuantity>0),eligible:order.status==="PAID"&&Boolean(original&&!original.reversal)&&!active};
}

export function calculatePosPartial(lines:Awaited<ReturnType<typeof posRefundState>>["remainingLines"],choices:{orderLineId:string;quantity:number}[]){
 if(!choices.length||new Set(choices.map(c=>c.orderLineId)).size!==choices.length)throw new PosRefundConflict("Select each original order line once");
 const snapshots=choices.map(c=>{const line=lines.find(l=>l.orderLineId===c.orderLineId);if(!line||c.quantity<1||c.quantity>line.remainingQuantity)throw new PosRefundConflict("Refund quantity exceeds the remaining original quantity");const netAmount=new Prisma.Decimal(line.unitPrice).mul(c.quantity),taxAmount=new Prisma.Decimal(line.remainingTax).mul(c.quantity).div(line.remainingQuantity).toDecimalPlaces(3,Prisma.Decimal.ROUND_HALF_UP);return{orderLineId:c.orderLineId,quantity:c.quantity,netAmount,taxAmount};});
 const netAmount=snapshots.reduce((n,l)=>n.plus(l.netAmount),new Prisma.Decimal(0)),taxAmount=snapshots.reduce((n,l)=>n.plus(l.taxAmount),new Prisma.Decimal(0));return{snapshots,netAmount,taxAmount,amount:netAmount.plus(taxAmount)};
}
