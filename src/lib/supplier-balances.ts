import {settlementNumber} from "./supplier-settlement";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {readableCompanyPermissions} from "./access";
import {dueDate} from "./date";
import {documentJournalNumber} from "./document-journal";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.optional(),asOf:dueDate,q:z.string().trim().max(120).default(""),format:z.enum(["json","csv"]).default("json")}).strict();
export class SupplierBalanceError extends Error{constructor(message:string,public status:number){super(message);}}
export async function supplierBalances(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new SupplierBalanceError("Invalid balance filters",400);
 const {tenantId,companyId,branchId,asOf,q,format}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["supplier:read","purchase-order:read","inventory-stock:read","ledger:read"]});
 const purchase=rights["purchase-order:read"],stock=rights["inventory-stock:read"],ledger=rights["ledger:read"];
 const supplierRights=rights["supplier:read"];
 if(supplierRights===false||purchase===false||stock===false||ledger===false)throw new SupplierBalanceError("Forbidden",403);
 const receiving=stock===null?ledger:ledger===null?stock:stock.filter(id=>ledger.includes(id));
 if(branchId&&receiving!==null&&!receiving.includes(branchId))throw new SupplierBalanceError("Forbidden",403);
 const supplierWhere={...(supplierRights===null?{}:{branchId:{in:supplierRights}}),...(q?{OR:[{displayName:{contains:q,mode:"insensitive" as const}},{code:{contains:q,mode:"insensitive" as const}}]}:{})};
 const sourceWhere={tenantId,companyId,...(branchId?{branchId}:receiving===null?{}:{branchId:{in:receiving}}),order:{...(purchase===null?{}:{branchId:{in:purchase}}),supplier:supplierWhere}};
 return db.$transaction(async tx=>{
  // Both original documents and their immutable correction journals stay in the report.
  // Bounds apply before building the journal lookup; never silently truncate a balance.
  const receipts=await tx.goodsReceipt.findMany({where:sourceWhere,select:{id:true,branchId:true,order:{select:{supplier:{select:{id:true,code:true,displayName:true,archivedAt:true}}}}},take:20001});
  const returns=await tx.goodsReturn.findMany({where:{tenantId,receipt:sourceWhere},select:{id:true,receipt:{select:{branchId:true,order:{select:{supplier:{select:{id:true,code:true,displayName:true,archivedAt:true}}}}}}},take:20001});
  const settlements=await tx.supplierSettlement.findMany({where:{tenantId,receipt:sourceWhere},select:{id:true,kind:true,receiptId:true,receipt:{select:{branchId:true,order:{select:{supplier:{select:{id:true,code:true,displayName:true,archivedAt:true}}}}}}},take:20001});
  if(receipts.length+returns.length+settlements.length>20000)throw new SupplierBalanceError("Statement exceeds 20000 source documents. Select a receiving branch.",413);
  const sources=new Map<string,{kind:"receipt"|"return"|"payment"|"refund";documentId:string;branchId:string;supplier:{id:string;code:string;displayName:string;archivedAt:Date|null}}>([...receipts.map(r=>[documentJournalNumber("purchase-receipt",r.id),{kind:"receipt",documentId:r.id,branchId:r.branchId,supplier:r.order.supplier}] as const),...returns.map(r=>[documentJournalNumber("purchase-return",r.id),{kind:"return",documentId:r.id,branchId:r.receipt.branchId,supplier:r.receipt.order.supplier}] as const),...settlements.map(s=>[settlementNumber(s.kind as "PAYMENT"|"REFUND",s.id),{kind:s.kind==="PAYMENT"?"payment" as const:"refund" as const,documentId:s.receiptId,branchId:s.receipt.branchId,supplier:s.receipt.order.supplier}] as const)]);
  const end=new Date(`${asOf}T00:00:00Z`);
  const entries=sources.size?await tx.journalEntry.findMany({where:{tenantId,companyId,entryDate:{lte:end},OR:[{number:{in:[...sources.keys()]}},{original:{number:{in:[...sources.keys()]}}}]},select:{id:true,number:true,entryDate:true,createdAt:true,currency:true,branchId:true,original:{select:{number:true}},lines:{select:{debit:true,credit:true,account:{select:{type:true}}}}},take:20001}):[];
  if(entries.length>20000)throw new SupplierBalanceError("Statement exceeds 20000 historical journals.",413);
  const groups=new Map<string,{supplier:{id:string;code:string;displayName:string;archivedAt:Date|null};currency:string;balance:Prisma.Decimal;journals:number;corrections:number}>();
  for(const e of entries){
   const source=sources.get(e.original?.number??e.number);if(!source||source.branchId!==e.branchId)continue;
   const key=source.supplier.id+":"+e.currency;
   let g=groups.get(key);if(!g){g={supplier:source.supplier,currency:e.currency,balance:new Prisma.Decimal(0),journals:0,corrections:0};groups.set(key,g);}
   g.balance=g.balance.plus(e.lines.filter(l=>l.account.type==="LIABILITY").reduce((n,l)=>n.plus(l.credit).minus(l.debit),new Prisma.Decimal(0)));g.journals++;if(e.original)g.corrections++;
  }
  if(groups.size>5000)throw new SupplierBalanceError("Report exceeds 5000 supplier/currency rows. Narrow the supplier search or receiving branch.",413);
  const totals=new Map<string,{currency:string;balance:Prisma.Decimal;positive:Prisma.Decimal;negative:Prisma.Decimal;suppliers:number}>();
  const rows=[...groups.values()].sort((a,b)=>a.supplier.displayName.localeCompare(b.supplier.displayName)||a.supplier.id.localeCompare(b.supplier.id)||a.currency.localeCompare(b.currency)).map(g=>{
   let t=totals.get(g.currency);if(!t){t={currency:g.currency,balance:new Prisma.Decimal(0),positive:new Prisma.Decimal(0),negative:new Prisma.Decimal(0),suppliers:0};totals.set(g.currency,t);}
   t.balance=t.balance.plus(g.balance);if(g.balance.gt(0))t.positive=t.positive.plus(g.balance);if(g.balance.lt(0))t.negative=t.negative.plus(g.balance);t.suppliers++;
   return {...g,balance:g.balance.toFixed(3)};
  });
  return {asOf,q,branchId:branchId??null,format,rows,summary:[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(t=>({...t,balance:t.balance.toFixed(3),positive:t.positive.toFixed(3),negative:t.negative.toFixed(3)}))};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export function supplierBalancesCsv(result:Awaited<ReturnType<typeof supplierBalances>>){
 return [["Type","As of (UTC)","Supplier code","Supplier","Archived","Journals","Corrections","Balance (credit minus debit)","Currency"],...result.rows.map(r=>["SUPPLIER",result.asOf,r.supplier.code,r.supplier.displayName,r.supplier.archivedAt?"YES":"NO",String(r.journals),String(r.corrections),r.balance,r.currency]),...result.summary.map(g=>["TOTAL",result.asOf,"","","", "","",g.balance,g.currency])].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
}
