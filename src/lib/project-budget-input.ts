import {z} from "zod";
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{const d=new Date(v+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v&&v>="2000-01-01"&&v<="2099-12-31";});
const amount=z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/);
const base=z.object({tenantId:uuid,requestId:uuid,expectedSequence:z.number().int().min(0).max(4999),currency:z.string().regex(/^[A-Z]{3}$/),note:z.string().trim().min(3).max(300)});
export const projectBudgetInput=z.discriminatedUnion("kind",[
 base.extend({kind:z.literal("SET_BUDGET"),amount}).strict(),
 base.extend({kind:z.literal("COST"),amount:amount.refine(v=>/[1-9]/.test(v)),costDate:date}).strict(),
 base.extend({kind:z.literal("REVERSE_COST"),costId:uuid}).strict(),
]);
export type ProjectBudgetInput=z.infer<typeof projectBudgetInput>;
export function budgetPending(raw:unknown,actorId:string,tenantId:string,projectId:string){
 const p=z.object({version:z.literal(1),actorId:uuid,projectId:uuid,request:projectBudgetInput}).strict().safeParse(raw);
 return p.success&&p.data.actorId===actorId&&p.data.projectId===projectId&&p.data.request.tenantId===tenantId?p.data.request:null;
}
export type BudgetEvent={reversed?:boolean;id:string;sequence:number;kind:string;amount:string;currency:string;costDate:string|null;reversesId:string|null;note:string;createdAt:string};
function units(value:string){if(!/^\d+\.\d{3}$/.test(value))throw new Error("Invalid budget amount");return BigInt(value.replace(".",""));}
function money(n:bigint){const negative=n<BigInt(0),a=negative?-n:n;return (negative?"-":"")+String(a/BigInt(1000))+"."+String(a%BigInt(1000)).padStart(3,"0");}
export function budgetSummary(events:BudgetEvent[],currency:string){
 let budget=BigInt(0),cost=BigInt(0),sequence=0;const sources=new Map<string,bigint>(),reversed=new Set<string>();
 for(const e of [...events].sort((a,b)=>a.sequence-b.sequence)){
  if(e.sequence!==sequence+1||e.currency!==currency||(sequence===0&&e.kind!=="SET_BUDGET"))throw new Error("Invalid budget history");sequence=e.sequence;const amount=units(e.amount);
  if(e.kind==="SET_BUDGET")budget=amount;
  else if(e.kind==="COST"){if(amount<=BigInt(0)||sources.has(e.id))throw new Error("Invalid cost");sources.set(e.id,amount);cost+=amount;}
  else if(e.kind==="REVERSE_COST"){if(!e.reversesId||reversed.has(e.reversesId)||sources.get(e.reversesId)!==amount)throw new Error("Invalid cost correction");reversed.add(e.reversesId);cost-=amount;}
  else throw new Error("Invalid budget event");
 }
 return {initialized:events.length>0,currency,sequence,budget:events.length?money(budget):null,cost:money(cost),remaining:events.length?money(budget-cost):null,overBudget:money(cost>budget?cost-budget:BigInt(0)),costEntries:sources.size-reversed.size};
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?"'"+v:v).replaceAll('"','""')}"`;
export function budgetCsv(scope:{tenantId:string;companyId:string;branchId:string|null;projectId:string;projectCode:string},events:BudgetEvent[],currency:string){
 const s=budgetSummary(events,currency),context=[scope.tenantId,scope.companyId,scope.branchId??"",scope.projectId,scope.projectCode,currency];
 const rows=[["Tenant ID","Company ID","Branch ID","Project ID","Project code","Currency","Type","Sequence","Kind","Amount","Cost date UTC","Note","Original cost ID","Event ID","Recorded UTC"],[...context,"SUMMARY",String(s.sequence),"BUDGET",s.budget??"","","","","",""],[...context,"SUMMARY",String(s.sequence),"NET_COST",s.cost,"","","","",""],[...context,"SUMMARY",String(s.sequence),"REMAINING",s.remaining??"","","","","",""],...events.map(e=>[...context,"EVENT",String(e.sequence),e.kind,e.amount,e.costDate??"",e.note,e.reversesId??"",e.id,e.createdAt])];
 return rows.map(r=>r.map(cell).join(",")).join("\r\n")+"\r\n";
}
