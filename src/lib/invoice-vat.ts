import {Prisma} from "@prisma/client";
import {z} from "zod";
export const vatTreatment=z.enum(["STANDARD","ZERO","EXEMPT"]);
export const vatChoices=z.array(z.object({position:z.number().int().min(0),treatment:vatTreatment}).strict()).min(1).max(500);
export class VatConflict extends Error{}
export function invoiceGross(i:{subtotal:Prisma.Decimal;vat?:{taxAmount:Prisma.Decimal}|null}){return i.subtotal.plus(i.vat?.taxAmount??0);}
export function calculateInvoiceVat(lines:{position:number;amount:Prisma.Decimal}[],choices:z.infer<typeof vatChoices>){
 if(choices.length!==lines.length||new Set(choices.map(c=>c.position)).size!==lines.length)throw new VatConflict("Classify every invoice line exactly once");
 const details=lines.map(l=>{const choice=choices.find(c=>c.position===l.position);if(!choice)throw new VatConflict("Missing invoice line classification");const tax=choice.treatment==="STANDARD"?l.amount.mul("0.05").toDecimalPlaces(3,Prisma.Decimal.ROUND_HALF_UP):new Prisma.Decimal(0);return{position:l.position,treatment:choice.treatment,net:l.amount.toFixed(3),tax:tax.toFixed(3)};});
 return {details,taxAmount:details.reduce((n,l)=>n.plus(l.tax),new Prisma.Decimal(0))};
}
