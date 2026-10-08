import {customerSettlementNumber} from "./customer-settlement";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {readableCompanyPermissions} from "./access";
import {dueDate} from "./date";
import {documentJournalNumber} from "./document-journal";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.optional(),asOf:dueDate,q:z.string().trim().max(120).default(""),format:z.enum(["json","csv"]).default("json")}).strict();
export class CustomerBalanceError extends Error{constructor(message:string,public status:number){super(message);}}
export async function customerBalances(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new CustomerBalanceError("Invalid balance filters",400);
 const {tenantId,companyId,branchId,asOf,q,format}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["customer:read","order:read","invoice:read","ledger:read"]});
 const orderRights=rights["order:read"],invoiceRights=rights["invoice:read"],ledger=rights["ledger:read"];
 const customerRights=rights["customer:read"];
 if(customerRights===false||orderRights===false||invoiceRights===false||ledger===false)throw new CustomerBalanceError("Forbidden",403);
 const invoiceBranches=invoiceRights===null?ledger:ledger===null?invoiceRights:invoiceRights.filter(id=>ledger.includes(id));
 if(branchId&&invoiceBranches!==null&&!invoiceBranches.includes(branchId))throw new CustomerBalanceError("Forbidden",403);
 const customerWhere={...(customerRights===null?{}:{branchId:{in:customerRights}}),...(q?{OR:[{displayName:{contains:q,mode:"insensitive" as const}},{code:{contains:q,mode:"insensitive" as const}}]}:{})};
 const sourceWhere={tenantId,companyId,...(branchId?{branchId}:invoiceBranches===null?{}:{branchId:{in:invoiceBranches}}),order:orderRights===null?{}:{branchId:{in:orderRights}},customer:customerWhere};
 return db.$transaction(async tx=>{
  // Both original documents and their immutable correction journals stay in the report.
  // Bounds apply before building the journal lookup; never silently truncate a balance.
  const invoices=await tx.invoice.findMany({where:sourceWhere,select:{id:true,branchId:true,customer:{select:{id:true,code:true,displayName:true,archivedAt:true}}},take:20001});
  const settlements=await tx.customerSettlement.findMany({where:{tenantId,invoice:sourceWhere},select:{id:true,kind:true,invoiceId:true},take:20001});
  if(invoices.length+settlements.length>20000)throw new CustomerBalanceError("Report exceeds 20000 sources. Select a branch.",413);
  const invoiceMap=new Map(invoices.map(i=>[i.id,i]));
  const sources=new Map<string,{kind:"invoice"|"collection"|"refund";documentId:string;branchId:string|null;customer:{id:string;code:string;displayName:string;archivedAt:Date|null}}>(invoices.map(i=>[documentJournalNumber("invoice",i.id),{kind:"invoice",documentId:i.id,branchId:i.branchId,customer:i.customer}]));
  for(const s of settlements){const i=invoiceMap.get(s.invoiceId);if(i)sources.set(customerSettlementNumber(s.kind as "COLLECTION"|"REFUND",s.id),{kind:s.kind==="COLLECTION"?"collection":"refund",documentId:i.id,branchId:i.branchId,customer:i.customer});}
  const end=new Date(`${asOf}T00:00:00Z`);
  const entries=sources.size?await tx.journalEntry.findMany({where:{tenantId,companyId,entryDate:{lte:end},OR:[{number:{in:[...sources.keys()]}},{original:{number:{in:[...sources.keys()]}}}]},select:{id:true,number:true,entryDate:true,createdAt:true,currency:true,branchId:true,original:{select:{number:true}},lines:{select:{position:true,accountId:true,debit:true,credit:true}}},take:20001}):[];
  if(entries.length>20000)throw new CustomerBalanceError("Statement exceeds 20000 historical journals.",413);
  const receivables=new Map(entries.filter(e=>sources.get(e.number)?.kind==="invoice").map(e=>[sources.get(e.number)!.documentId,e.lines.find(l=>l.position===0)?.accountId]));
  const groups=new Map<string,{customer:{id:string;code:string;displayName:string;archivedAt:Date|null};currency:string;balance:Prisma.Decimal;journals:number;corrections:number}>();
  for(const e of entries){
   const source=sources.get(e.original?.number??e.number);if(!source||source.branchId!==e.branchId)continue;
   const receivable=receivables.get(source.documentId);if(!receivable)throw new CustomerBalanceError("Original invoice receivable is unavailable.",409);
   const key=source.customer.id+":"+e.currency;
   let g=groups.get(key);if(!g){g={customer:source.customer,currency:e.currency,balance:new Prisma.Decimal(0),journals:0,corrections:0};groups.set(key,g);}
   g.balance=g.balance.plus(e.lines.filter(l=>l.accountId===receivable).reduce((n,l)=>n.plus(l.debit).minus(l.credit),new Prisma.Decimal(0)));g.journals++;if(e.original)g.corrections++;
  }
  if(groups.size>5000)throw new CustomerBalanceError("Report exceeds 5000 customer/currency rows. Narrow the customer search or invoice branch.",413);
  const totals=new Map<string,{currency:string;balance:Prisma.Decimal;positive:Prisma.Decimal;negative:Prisma.Decimal;customers:number}>();
  const rows=[...groups.values()].sort((a,b)=>a.customer.displayName.localeCompare(b.customer.displayName)||a.customer.id.localeCompare(b.customer.id)||a.currency.localeCompare(b.currency)).map(g=>{
   let t=totals.get(g.currency);if(!t){t={currency:g.currency,balance:new Prisma.Decimal(0),positive:new Prisma.Decimal(0),negative:new Prisma.Decimal(0),customers:0};totals.set(g.currency,t);}
   t.balance=t.balance.plus(g.balance);if(g.balance.gt(0))t.positive=t.positive.plus(g.balance);if(g.balance.lt(0))t.negative=t.negative.plus(g.balance);t.customers++;
   return {...g,balance:g.balance.toFixed(3)};
  });
  return {asOf,q,branchId:branchId??null,format,rows,summary:[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(t=>({...t,balance:t.balance.toFixed(3),positive:t.positive.toFixed(3),negative:t.negative.toFixed(3)}))};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export function customerBalancesCsv(result:Awaited<ReturnType<typeof customerBalances>>){
 return [["Type","As of (UTC)","Customer code","Customer","Archived","Journals","Corrections","Balance (debit minus credit)","Currency"],...result.rows.map(r=>["CUSTOMER",result.asOf,r.customer.code,r.customer.displayName,r.customer.archivedAt?"YES":"NO",String(r.journals),String(r.corrections),r.balance,r.currency]),...result.summary.map(g=>["TOTAL",result.asOf,"","","", "","",g.balance,g.currency])].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
