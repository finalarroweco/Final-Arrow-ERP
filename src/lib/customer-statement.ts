import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {canAccess,readableCompanyPermissions} from "./access";
import {dueDate} from "./date";
import {documentJournalNumber} from "./document-journal";
import {customerSettlementNumber} from "./customer-settlement";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,customerId:uuid,branchId:uuid.optional(),from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).strict().refine(v=>v.from<=v.to&&(Date.parse(v.to)-Date.parse(v.from))/86400000<366);
export class CustomerStatementError extends Error{constructor(message:string,public status:number){super(message);}}
export async function customerStatement(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new CustomerStatementError("Invalid statement filters (maximum 366 days)",400);
 const {tenantId,companyId,customerId,branchId,from,to,format}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["invoice:read","order:read","ledger:read"]});
 const invoiceRights=rights["invoice:read"],orderRights=rights["order:read"],ledger=rights["ledger:read"];
 if(invoiceRights===false||orderRights===false||ledger===false)throw new CustomerStatementError("Forbidden",403);
 const branches=invoiceRights===null?ledger:ledger===null?invoiceRights:invoiceRights.filter(id=>ledger.includes(id));
 if(branchId&&branches!==null&&!branches.includes(branchId))throw new CustomerStatementError("Forbidden",403);
 const customer=await db.customer.findFirst({where:{id:customerId,tenantId,companyId},select:{id:true,code:true,displayName:true,branchId:true,archivedAt:true}});
 if(!customer)throw new CustomerStatementError("Customer not found",404);
 if(!(await canAccess({userId,tenantId,companyId,branchId:customer.branchId??undefined,permission:"customer:read"})))throw new CustomerStatementError("Forbidden",403);
 const sourceWhere={tenantId,companyId,customerId,...(branchId?{branchId}:branches===null?{}:{branchId:{in:branches}}),...(orderRights===null?{}:{order:{branchId:{in:orderRights}}})};
 return db.$transaction(async tx=>{
  const invoices=await tx.invoice.findMany({where:sourceWhere,select:{id:true,number:true,branchId:true},take:20001});
  const settlements=await tx.customerSettlement.findMany({where:{tenantId,invoice:sourceWhere},select:{id:true,kind:true,invoiceId:true},take:20001});
  if(invoices.length+settlements.length>20000)throw new CustomerStatementError("Statement exceeds 20000 sources. Select a branch.",413);
  const invoiceMap=new Map(invoices.map(i=>[i.id,i]));
  const sources=new Map<string,{kind:"invoice"|"collection"|"refund";documentId:string;branchId:string|null;invoice:string}>(invoices.map(i=>[documentJournalNumber("invoice",i.id),{kind:"invoice",documentId:i.id,branchId:i.branchId,invoice:i.number}]));
  for(const s of settlements){const i=invoiceMap.get(s.invoiceId);if(i)sources.set(customerSettlementNumber(s.kind as "COLLECTION"|"REFUND",s.id),{kind:s.kind==="COLLECTION"?"collection":"refund",documentId:i.id,branchId:i.branchId,invoice:i.number});}
  const entries=sources.size?await tx.journalEntry.findMany({where:{tenantId,companyId,entryDate:{lte:new Date(`${to}T00:00:00Z`)},OR:[{number:{in:[...sources.keys()]}},{original:{number:{in:[...sources.keys()]}}}]},select:{id:true,number:true,entryDate:true,createdAt:true,currency:true,branchId:true,original:{select:{number:true}},lines:{select:{position:true,accountId:true,debit:true,credit:true}}},take:20001}):[];
  if(entries.length>20000)throw new CustomerStatementError("Statement exceeds 20000 historical journals.",413);
  // Collection journals contain two asset accounts: only the original invoice
  // receivable contributes to a customer balance, never the cash/bank line.
  const receivables=new Map(entries.filter(e=>sources.get(e.number)?.kind==="invoice").map(e=>[sources.get(e.number)!.documentId,e.lines.find(l=>l.position===0)?.accountId]));
  entries.sort((a,b)=>a.entryDate.getTime()-b.entryDate.getTime()||a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id));
  const groups=new Map<string,{currency:string;opening:Prisma.Decimal;increase:Prisma.Decimal;decrease:Prisma.Decimal;closing:Prisma.Decimal}>();
  const rows=[],start=new Date(`${from}T00:00:00Z`);
  for(const e of entries){const source=sources.get(e.original?.number??e.number);if(!source||source.branchId!==e.branchId)continue;
   const receivable=receivables.get(source.documentId);if(!receivable)throw new CustomerStatementError("Original invoice receivable is unavailable.",409);
   const change=e.lines.filter(l=>l.accountId===receivable).reduce((n,l)=>n.plus(l.debit).minus(l.credit),new Prisma.Decimal(0));
   let g=groups.get(e.currency);if(!g){g={currency:e.currency,opening:new Prisma.Decimal(0),increase:new Prisma.Decimal(0),decrease:new Prisma.Decimal(0),closing:new Prisma.Decimal(0)};groups.set(e.currency,g);}
   g.closing=g.closing.plus(change);if(e.entryDate<start){g.opening=g.opening.plus(change);continue;}
   const increase=change.gt(0)?change:new Prisma.Decimal(0),decrease=change.lt(0)?change.negated():new Prisma.Decimal(0);g.increase=g.increase.plus(increase);g.decrease=g.decrease.plus(decrease);
   rows.push({id:e.id,number:e.number,date:e.entryDate.toISOString().slice(0,10),currency:e.currency,...source,reversal:!!e.original,increase:increase.toFixed(3),decrease:decrease.toFixed(3),balance:g.closing.toFixed(3)});
   if(rows.length>5000)throw new CustomerStatementError("Statement exceeds 5000 period journals. Select a shorter period.",413);
  }
  return {customer,from,to,branchId:branchId??null,format,rows,summary:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({currency:g.currency,opening:g.opening.toFixed(3),increase:g.increase.toFixed(3),decrease:g.decrease.toFixed(3),closing:g.closing.toFixed(3)}))};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export function customerStatementCsv(result:Awaited<ReturnType<typeof customerStatement>>){
 return [["Type","Customer code","Customer","Date","Invoice","Journal","Source invoice","Branch","Increase","Decrease","Balance (debit minus credit)","Currency"],...result.summary.map(g=>["OPENING",result.customer.code,result.customer.displayName,result.from,"","","","","","",g.opening,g.currency]),...result.rows.map(r=>[r.reversal?"REVERSAL":r.kind.toUpperCase(),result.customer.code,result.customer.displayName,r.date,r.invoice,r.number,r.documentId,r.branchId??"",r.increase,r.decrease,r.balance,r.currency]),...result.summary.map(g=>["CLOSING",result.customer.code,result.customer.displayName,result.to,"","","","",g.increase,g.decrease,g.closing,g.currency])].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
