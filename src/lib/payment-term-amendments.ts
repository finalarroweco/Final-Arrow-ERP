import {invoiceDocumentSourceAllowed,invoiceSourceSelect} from "./invoice-source";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {canAccess} from "./access";
import {lockDocument} from "./document-journal";
import {OperationalError,operationalAudit} from "./operational-records";
import {recordedPaymentTerms,type PaymentTermAmendmentInput,type PaymentTermSourceKind} from "./payment-term-amendment-input";
// Only these rejections follow a locked source and a confirmed absent UUID.
// Ordinary conflicts can represent a previously committed attempt by another actor.
export class PaymentTermRequestNotRecorded extends OperationalError {
 constructor(message:string,public requestId:string){super(message,409);}
}
const changeSelect={id:true,tenantId:true,companyId:true,branchId:true,invoiceId:true,receiptId:true,sequence:true,paymentTerms:true,paymentDueDate:true,reason:true,createdBy:true,createdAt:true} as const;
const sourceWhere=(tenantId:string,kind:PaymentTermSourceKind,id:string)=>({tenantId,...(kind==="invoice"?{invoiceId:id}:{receiptId:id})});
async function paymentSource(tx:Prisma.TransactionClient,actorId:string,tenantId:string,kind:PaymentTermSourceKind,id:string,manage=false){
 if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(tenantId).success)throw new OperationalError("Invalid source",400);
 const common={id:true,tenantId:true,companyId:true,branchId:true,paymentTerms:true,paymentDueDate:true} as const;
 const invoice=kind==="invoice"?await tx.invoice.findUnique({where:{tenantId_id:{tenantId,id}},select:{...common,...invoiceSourceSelect,number:true,status:true}}):null;
 const receipt=kind==="receipt"?await tx.goodsReceipt.findUnique({where:{tenantId_id:{tenantId,id}},select:{...common,order:{select:{number:true,branchId:true}}}}):null;
 const source=invoice??receipt;if(!source)throw new OperationalError("Source not found",404);
 const scope={userId:actorId,tenantId,companyId:source.companyId,branchId:source.branchId??undefined};
 const checks=[canAccess({...scope,permission:kind==="invoice"?"invoice:read":"inventory-stock:read"},tx)];
 if(invoice)checks.push(invoiceDocumentSourceAllowed(actorId,invoice,tx));
 if(receipt)checks.push(canAccess({...scope,branchId:receipt.order.branchId??undefined,permission:"purchase-order:read"},tx));
 if(!(await Promise.all(checks)).every(Boolean))throw new OperationalError("Forbidden",403);
 const hasManagement=await canAccess({...scope,permission:kind==="invoice"?"invoice-payment-term:manage":"receipt-payment-term:manage"},tx);
 if(manage&&!hasManagement)throw new OperationalError("Forbidden",403);
 return {source:{id:source.id,tenantId,companyId:source.companyId,branchId:source.branchId,reference:invoice?.number??`${receipt!.order.number} / ${source.id}`,status:invoice?.status??null,kind},original:source,canManage:hasManagement&&invoice?.status!=="VOID"};
}
const serialized=(row:Prisma.PaymentTermAmendmentGetPayload<{select:typeof changeSelect}>)=>({...row,paymentDueDate:row.paymentDueDate?.toISOString().slice(0,10)??null,createdAt:row.createdAt.toISOString()});
export async function paymentTermDetails(actorId:string,tenantId:string,kind:PaymentTermSourceKind,id:string,page=0){
 if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(tenantId).success)throw new OperationalError("Invalid source",400);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
  if(kind==="invoice")await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR SHARE`;
  else await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR SHARE`;
  const parent=await paymentSource(tx,actorId,tenantId,kind,id);
  const where=sourceWhere(tenantId,kind,id);
  const [latest,records]=await Promise.all([tx.paymentTermAmendment.findFirst({where,orderBy:{sequence:"desc"},select:changeSelect}),tx.paymentTermAmendment.findMany({where,orderBy:{sequence:"desc"},select:changeSelect,skip:page*50,take:51})]);
  const changes=records.slice(0,50),users=await tx.user.findMany({where:{id:{in:[...new Set(changes.map(row=>row.createdBy))]}},select:{id:true,name:true}}),names=new Map(users.map(user=>[user.id,user.name]));
  const current=recordedPaymentTerms(parent.original,latest);
  return {source:parent.source,canManage:parent.canManage,original:{paymentTerms:current.originalPaymentTerms,paymentDueDate:current.originalPaymentDueDate},current:{paymentTerms:current.paymentTerms,paymentDueDate:current.paymentDueDate,sequence:current.paymentTermsSequence,recordedAt:current.paymentTermsRecordedAt},changes:changes.map(row=>({...serialized(row),authorName:names.get(row.createdBy)??null})),nextPage:records.length>50?page+1:null};
 },{isolationLevel:"ReadCommitted",timeout:15000,maxWait:10000});
}
export async function amendPaymentTerms(actorId:string,kind:PaymentTermSourceKind,rawId:string,input:PaymentTermAmendmentInput){
 if(!z.string().uuid().safeParse(rawId).success)throw new OperationalError("Invalid source",400);const id=rawId.toLowerCase();
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${input.tenantId}::uuid FOR SHARE`;
  await lockDocument(tx,kind==="invoice"?"invoice":"purchase-receipt",input.tenantId,id);
  // Recheck current permissions even for exact replay, after waiting for the source lock.
  const parent=await paymentSource(tx,actorId,input.tenantId,kind,id,true);
  const previous=await tx.paymentTermAmendment.findUnique({where:{id:input.requestId},select:changeSelect});
  if(previous){
   if(previous.tenantId!==input.tenantId||previous.createdBy!==actorId||previous.invoiceId!==(kind==="invoice"?id:null)||previous.receiptId!==(kind==="receipt"?id:null)||previous.sequence!==input.expectedSequence+1||previous.paymentTerms!==(input.paymentTerms?.label??null)||(previous.paymentDueDate?.toISOString().slice(0,10)??null)!==(input.paymentTerms?.dueDate??null)||previous.reason!==input.reason)throw new OperationalError("Request ID already used with different amendment data");
   return {change:serialized(previous),replayed:true};
  }
  if(parent.source.status==="VOID")throw new PaymentTermRequestNotRecorded("Voided invoices cannot receive new payment-term amendments",input.requestId);
  const latest=await tx.paymentTermAmendment.findFirst({where:sourceWhere(input.tenantId,kind,id),orderBy:{sequence:"desc"},select:changeSelect});
  if((latest?.sequence??0)!==input.expectedSequence)throw new PaymentTermRequestNotRecorded("Payment terms changed. Reload the current terms before recording a new amendment.",input.requestId);
  const current=recordedPaymentTerms(parent.original,latest);
  if(current.paymentTerms===(input.paymentTerms?.label??null)&&current.paymentDueDate===(input.paymentTerms?.dueDate??null))throw new PaymentTermRequestNotRecorded("Amendment must change the current recorded terms",input.requestId);
  const change=await tx.paymentTermAmendment.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:parent.source.companyId,branchId:parent.source.branchId,...(kind==="invoice"?{invoiceId:id}:{receiptId:id}),sequence:input.expectedSequence+1,paymentTerms:input.paymentTerms?.label??null,paymentDueDate:input.paymentTerms?new Date(input.paymentTerms.dueDate+"T00:00:00Z"):null,reason:input.reason,createdBy:actorId},select:changeSelect});
  await operationalAudit(tx,input.tenantId,actorId,"PaymentTermAmendment",change.id,"payment-term.amended",id,change.sequence);
  return {change:serialized(change),replayed:false};
 },{timeout:15000,maxWait:10000});
}

// Bounded top-one lookup in PostgreSQL. Do not use a nested relation take here:
// some Prisma query plans load complete histories before per-parent pagination.
export async function paymentTermAmendmentsAt(tx:Prisma.TransactionClient,tenantId:string,kind:PaymentTermSourceKind,ids:string[],cutoff:Date){
 if(!ids.length)return new Map<string,{sequence:number;paymentTerms:string|null;paymentDueDate:Date|null;createdAt:Date}>();
 const field=kind==="invoice"?Prisma.sql`"invoiceId"`:Prisma.sql`"receiptId"`;
 const rows=await tx.$queryRaw<{sourceId:string;sequence:number;paymentTerms:string|null;paymentDueDate:Date|null;createdAt:Date}[]>(Prisma.sql`
  SELECT source.id AS "sourceId", amendment.sequence, amendment."paymentTerms", amendment."paymentDueDate", amendment."createdAt"
  FROM unnest(${ids}::uuid[]) AS source(id)
  CROSS JOIN LATERAL (SELECT sequence,"paymentTerms","paymentDueDate","createdAt" FROM "PaymentTermAmendment"
   WHERE "tenantId"=${tenantId}::uuid AND ${field}=source.id AND "createdAt"<${cutoff}
   ORDER BY "createdAt" DESC, sequence DESC LIMIT 1) amendment`);
 return new Map(rows.map(row=>[row.sourceId,row]));
}
