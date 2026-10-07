import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {canAccess,readableCompanyPermissions} from "./access";
import {dueDate} from "./date";
import {documentJournalNumber} from "./document-journal";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,supplierId:uuid,branchId:uuid.optional(),from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).strict().refine(v=>v.from<=v.to&&(Date.parse(v.to)-Date.parse(v.from))/86400000<366);
export class SupplierStatementError extends Error{constructor(message:string,public status:number){super(message);}}
export async function supplierStatement(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new SupplierStatementError("Invalid statement filters (maximum 366 days)",400);
 const {tenantId,companyId,supplierId,branchId,from,to,format}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["purchase-order:read","inventory-stock:read","ledger:read"]});
 const purchase=rights["purchase-order:read"],stock=rights["inventory-stock:read"],ledger=rights["ledger:read"];
 if(purchase===false||stock===false||ledger===false)throw new SupplierStatementError("Forbidden",403);
 const receiving=stock===null?ledger:ledger===null?stock:stock.filter(id=>ledger.includes(id));
 if(branchId&&receiving!==null&&!receiving.includes(branchId))throw new SupplierStatementError("Forbidden",403);
 const supplier=await db.supplier.findFirst({where:{id:supplierId,tenantId,companyId},select:{id:true,code:true,displayName:true,branchId:true,archivedAt:true}});
 if(!supplier)throw new SupplierStatementError("Supplier not found",404);
 if(!(await canAccess({userId,tenantId,companyId,branchId:supplier.branchId??undefined,permission:"supplier:read"})))throw new SupplierStatementError("Forbidden",403);
 const sourceWhere={tenantId,companyId,...(branchId?{branchId}:receiving===null?{}:{branchId:{in:receiving}}),order:{supplierId,...(purchase===null?{}:{branchId:{in:purchase}})}};
 return db.$transaction(async tx=>{
  // Both original documents and their immutable correction journals stay in the report.
  // Bounds apply before building the journal lookup; never silently truncate a balance.
  const receipts=await tx.goodsReceipt.findMany({where:sourceWhere,select:{id:true,branchId:true,order:{select:{number:true}}},take:20001});
  const returns=await tx.goodsReturn.findMany({where:{tenantId,receipt:sourceWhere},select:{id:true,receipt:{select:{branchId:true,order:{select:{number:true}}}}},take:20001});
  if(receipts.length+returns.length>20000)throw new SupplierStatementError("Statement exceeds 20000 source documents. Select a receiving branch.",413);
  const sources=new Map<string,{kind:"receipt"|"return";documentId:string;branchId:string;order:string}>([...receipts.map(r=>[documentJournalNumber("purchase-receipt",r.id),{kind:"receipt",documentId:r.id,branchId:r.branchId,order:r.order.number}] as const),...returns.map(r=>[documentJournalNumber("purchase-return",r.id),{kind:"return",documentId:r.id,branchId:r.receipt.branchId,order:r.receipt.order.number}] as const)]);
  const end=new Date(`${to}T00:00:00Z`),start=new Date(`${from}T00:00:00Z`);
  const entries=sources.size?await tx.journalEntry.findMany({where:{tenantId,companyId,entryDate:{lte:end},OR:[{number:{in:[...sources.keys()]}},{original:{number:{in:[...sources.keys()]}}}]},select:{id:true,number:true,entryDate:true,createdAt:true,currency:true,branchId:true,original:{select:{number:true}},lines:{select:{debit:true,credit:true,account:{select:{type:true}}}}},take:20001}):[];
  if(entries.length>20000)throw new SupplierStatementError("Statement exceeds 20000 historical journals.",413);
  entries.sort((a,b)=>a.entryDate.getTime()-b.entryDate.getTime()||a.createdAt.getTime()-b.createdAt.getTime()||a.id.localeCompare(b.id));
  const groups=new Map<string,{currency:string;opening:Prisma.Decimal;increase:Prisma.Decimal;decrease:Prisma.Decimal;closing:Prisma.Decimal}>();
  const group=(currency:string)=>{let g=groups.get(currency);if(!g){g={currency,opening:new Prisma.Decimal(0),increase:new Prisma.Decimal(0),decrease:new Prisma.Decimal(0),closing:new Prisma.Decimal(0)};groups.set(currency,g);}return g;};
  const rows=[];
  for(const e of entries){
   const source=sources.get(e.original?.number??e.number);if(!source||source.branchId!==e.branchId)continue;
   const change=e.lines.filter(l=>l.account.type==="LIABILITY").reduce((n,l)=>n.plus(l.credit).minus(l.debit),new Prisma.Decimal(0));
   const g=group(e.currency);g.closing=g.closing.plus(change);
   if(e.entryDate<start){g.opening=g.opening.plus(change);continue;}
   const increase=change.gt(0)?change:new Prisma.Decimal(0),decrease=change.lt(0)?change.negated():new Prisma.Decimal(0);
   g.increase=g.increase.plus(increase);g.decrease=g.decrease.plus(decrease);
   rows.push({id:e.id,number:e.number,date:e.entryDate.toISOString().slice(0,10),currency:e.currency,...source,reversal:!!e.original,increase:increase.toFixed(3),decrease:decrease.toFixed(3),balance:g.closing.toFixed(3)});
   if(rows.length>5000)throw new SupplierStatementError("Statement exceeds 5000 period journals. Select a shorter period.",413);
  }
  return {supplier,from,to,branchId:branchId??null,format,rows,summary:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({currency:g.currency,opening:g.opening.toFixed(3),increase:g.increase.toFixed(3),decrease:g.decrease.toFixed(3),closing:g.closing.toFixed(3)}))};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export function supplierStatementCsv(result:Awaited<ReturnType<typeof supplierStatement>>){
 return [["Type","Supplier code","Supplier","Date","Order","Journal","Source document","Branch","Increase","Decrease","Balance (credit minus debit)","Currency"],...result.summary.map(g=>["OPENING",result.supplier.code,result.supplier.displayName,result.from,"","","","","","",g.opening,g.currency]),...result.rows.map(r=>[r.reversal?"REVERSAL":r.kind.toUpperCase(),result.supplier.code,result.supplier.displayName,r.date,r.order,r.number,r.documentId,r.branchId,r.increase,r.decrease,r.balance,r.currency]),...result.summary.map(g=>["CLOSING",result.supplier.code,result.supplier.displayName,result.to,"","","","",g.increase,g.decrease,g.closing,g.currency])].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
