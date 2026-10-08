import {Prisma} from "@prisma/client";
import {z} from "zod";
import {VatConflict} from "./invoice-vat";
export const purchaseVatInput=z.object({supplierTaxNumber:z.string().trim().min(3).max(40).nullable(),reference:z.string().trim().min(3).max(120),lines:z.array(z.object({receiptLineId:z.string().uuid(),treatment:z.enum(["STANDARD","ZERO","EXEMPT","NO_VAT"]),recoverable:z.boolean()}).strict().refine(l=>!l.recoverable||l.treatment==="STANDARD")).min(1).max(50)}).strict().refine(s=>!s.lines.some(l=>l.treatment==="STANDARD")||!!s.supplierTaxNumber);
export type PurchaseTaxLine={receiptLineId:string;quantity:string;net:string;tax:string;treatment:"STANDARD"|"ZERO"|"EXEMPT"|"NO_VAT";recoverable:boolean};
export function purchaseTaxDetails(details:Prisma.JsonValue){return details as unknown as PurchaseTaxLine[];}
export function sumPurchaseTax(details:PurchaseTaxLine[]){return details.reduce((s,l)=>({netAmount:s.netAmount.plus(l.net),taxAmount:s.taxAmount.plus(l.tax),recoverableTax:s.recoverableTax.plus(l.recoverable?l.tax:0)}),{netAmount:new Prisma.Decimal(0),taxAmount:new Prisma.Decimal(0),recoverableTax:new Prisma.Decimal(0)});}
export function calculatePurchaseVat(lines:{id:string;quantity:Prisma.Decimal;unitPrice:Prisma.Decimal}[],input:z.infer<typeof purchaseVatInput>){
 if(input.lines.length!==lines.length||new Set(input.lines.map(l=>l.receiptLineId)).size!==lines.length)throw new VatConflict("Classify each received line exactly once");
 const details=lines.map(l=>{const choice=input.lines.find(c=>c.receiptLineId===l.id);if(!choice)throw new VatConflict("Missing receipt line classification");const net=l.quantity.mul(l.unitPrice),tax=choice.treatment==="STANDARD"?net.mul("0.05").toDecimalPlaces(3,Prisma.Decimal.ROUND_HALF_UP):new Prisma.Decimal(0);return{receiptLineId:l.id,quantity:l.quantity.toFixed(3),net:net.toFixed(3),tax:tax.toFixed(3),treatment:choice.treatment,recoverable:choice.recoverable};});
 return{...sumPurchaseTax(details),details,supplierTaxNumber:input.supplierTaxNumber,reference:input.reference};
}
export async function returnPurchaseVat(tx:Prisma.TransactionClient,receiptId:string,returnId:string,lines:{receiptLineId:string;quantity:number;unitPrice:Prisma.Decimal}[]){
 const saved=await tx.purchaseVat.findUnique({where:{returnId}});if(saved)return saved;
 const original=await tx.purchaseVat.findFirst({where:{receiptId,returnId:null}});if(!original)return null;
 const prior=await tx.purchaseVat.findMany({where:{receiptId,returnId:{not:null}},select:{details:true}}),originalLines=purchaseTaxDetails(original.details);
 const details=lines.map(l=>{const o=originalLines.find(d=>d.receiptLineId===l.receiptLineId);if(!o)throw new VatConflict("Original receipt VAT line is unavailable");const qty=new Prisma.Decimal(l.quantity),before=prior.flatMap(p=>purchaseTaxDetails(p.details)).filter(d=>d.receiptLineId===l.receiptLineId).reduce((n,d)=>n.plus(d.quantity),new Prisma.Decimal(0)),received=new Prisma.Decimal(o.quantity);if(before.plus(qty).gt(received))throw new VatConflict("Return exceeds original VAT quantity");const cumulative=(q:Prisma.Decimal)=>new Prisma.Decimal(o.tax).mul(q).div(received).toDecimalPlaces(3,Prisma.Decimal.ROUND_HALF_UP);return{...o,quantity:qty.toFixed(3),net:qty.mul(l.unitPrice).toFixed(3),tax:cumulative(before.plus(qty)).minus(cumulative(before)).toFixed(3)};});
 return{...sumPurchaseTax(details),details:details as unknown as Prisma.JsonValue,inputAccountId:original.inputAccountId,supplierName:original.supplierName,supplierTaxNumber:original.supplierTaxNumber,reference:original.reference};
}
