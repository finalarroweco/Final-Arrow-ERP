import {Prisma} from "@prisma/client";
import {z} from "zod";
export const expenseVatInput=z.object({supplierName:z.string().trim().min(2).max(200),supplierTaxNumber:z.string().trim().min(3).max(40).nullable(),reference:z.string().trim().min(3).max(120),treatment:z.enum(["STANDARD","ZERO","EXEMPT","NO_VAT"]),recoverable:z.boolean()}).strict().refine(v=>(!v.recoverable||v.treatment==="STANDARD")&&(v.treatment!=="STANDARD"||!!v.supplierTaxNumber));
export function calculateExpenseVat(netAmount:Prisma.Decimal,input:z.infer<typeof expenseVatInput>){const taxAmount=input.treatment==="STANDARD"?netAmount.mul("0.05").toDecimalPlaces(3,Prisma.Decimal.ROUND_HALF_UP):new Prisma.Decimal(0);return{...input,netAmount,taxAmount,recoverableTax:input.recoverable?taxAmount:new Prisma.Decimal(0)};}
export function expenseGross(row:{amount:Prisma.Decimal;vat:{taxAmount:Prisma.Decimal}|null}){return row.amount.plus(row.vat?.taxAmount??0);}
