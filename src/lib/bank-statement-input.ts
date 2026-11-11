import {z} from "zod";
import {dueDate} from "./date";
import {moneyMillis,moneyText} from "./exact-money";
export const bankScope=z.object({tenantId:z.string().uuid(),companyId:z.string().uuid()});
const signed=z.string().regex(/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/);
const reference=z.string().trim().min(1).max(120).refine(s=>!/[\u0000-\u001f]/u.test(s));
export const bankStatementInput=bankScope.extend({requestId:z.string().uuid(),accountId:z.string().uuid(),reference:reference.refine(s=>s.length>=3),from:dueDate,to:dueDate,opening:signed,closing:signed,lines:z.array(z.object({bookingDate:dueDate,reference,amount:signed}).strict()).max(500)}).strict().refine(s=>s.from<=s.to&&(Date.parse(s.to)-Date.parse(s.from))/86400000<366);
export type BankStatementInput=z.infer<typeof bankStatementInput>;
// This is the original normalized hash input, including its property order. Never add an actor here.
export function statementHashInput(input:BankStatementInput){
 const s=bankStatementInput.parse(input);
 const data={...s,opening:moneyText(moneyMillis(s.opening)),closing:moneyText(moneyMillis(s.closing)),lines:s.lines.map(l=>({...l,amount:moneyText(moneyMillis(l.amount))}))};
 if(data.lines.some(l=>moneyMillis(l.amount)===BigInt(0)||l.bookingDate<data.from||l.bookingDate>data.to))throw Error("Each movement must be nonzero and inside the statement dates");
 if(data.lines.reduce((n,l)=>n+moneyMillis(l.amount),moneyMillis(data.opening))!==moneyMillis(data.closing))throw Error("Opening balance plus signed movements must equal closing balance");
 return data;
}
