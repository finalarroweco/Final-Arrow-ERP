import {createHash,randomUUID} from 'node:crypto';
import {cookies} from 'next/headers';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {BillingError} from './recurring-billing';
import {loadTimeInvoiceAccess} from './project-time-invoice-access';
import {projectTimeInvoicePrices} from './project-time-invoice-pricing';
import {canonicalTimeInvoiceRequest,projectTimeInvoiceFilters,type TimeInvoiceSelection,type TimeInvoiceRequest} from './project-time-invoice-input';
import type {z} from 'zod';
const options={timeout:30000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const date=(value:Date)=>value.toISOString().slice(0,10);
export async function requireTimeInvoiceSession(tx:Prisma.TransactionClient,actorId:string){
 const token=(await cookies()).get('fa_erp_session')?.value;
 if(!token||!/^[0-9a-f]{64}$/.test(token))throw new BillingError('Session expired',401);
 const tokenHash=createHash('sha256').update(token).digest('hex');
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Session" WHERE "tokenHash"=${tokenHash} AND "userId"=${actorId}::uuid AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
 if(rows.length!==1)throw new BillingError('Session expired or revoked',401);
}
async function lock(tx:Prisma.TransactionClient,p:TimeInvoiceSelection&{requestId?:string}){
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "Company" WHERE "tenantId"=${p.tenantId}::uuid AND id=${p.companyId}::uuid FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${p.customerId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${p.projectId}::uuid FOR UPDATE`;
 if(p.requestId)await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'project-time-invoice:'+p.requestId},0))`;
}
async function context(tx:Prisma.TransactionClient,actorId:string,p:TimeInvoiceSelection,write=false){
 await requireTimeInvoiceSession(tx,actorId);
 if(actorId!==p.expectedActorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadTimeInvoiceAccess(tx,actorId,p.tenantId);
 for(const key of ['project:read','project-time:read','project-time-invoice:read',...(write?['project-time-invoice:generate','invoice:read','invoice:create','project-billing:read','project-billing:manage']:[])])if(!access.can(key,p))throw new BillingError('Current project time invoicing access required',403);
 const project=await tx.project.findFirst({where:{id:p.projectId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId}});
 const customer=await tx.customer.findFirst({where:{id:p.customerId,tenantId:p.tenantId,companyId:p.companyId}});
 if(!project)throw new BillingError('Project not found',404);
 if(!customer||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Current customer access required',403);
 return {access,project,customer};
}
async function preview(tx:Prisma.TransactionClient,actorId:string,p:TimeInvoiceSelection){
 const {project,customer,access}=await context(tx,actorId,p);
 const selected=[...p.entries].sort((a,b)=>a.entryId.localeCompare(b.entryId));
 const rows=await tx.projectTimeEntry.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,id:{in:selected.map(e=>e.entryId)}},orderBy:{id:'asc'}});
 if(rows.length!==selected.length)throw new BillingError('Selected time is unavailable',404);
 const entries=rows.map((row,i)=>{const chosen=selected[i];if(row.reviewState!=='APPROVED'||row.voidedAt||row.reviewSequence!==chosen.expectedSequence)throw new BillingError('Time approval changed. Refresh selected entries.');return {entryId:row.id,minutes:row.minutes,description:row.description,workDate:date(row.workDate),reviewSequence:row.reviewSequence,hourlyRate:chosen.hourlyRate,treatment:chosen.treatment};});
 const claims=await tx.projectTimeInvoiceClaim.findMany({where:{entryId:{in:rows.map(e=>e.id)}}});
 let outcome='READY';
 if(project.status==='CANCELLED'&&!p.replacesSourceId||customer.archivedAt)outcome='UNAVAILABLE';
 if(p.replacesSourceId){
  if(!access.can('invoice:read',p))throw new BillingError('Invoice read required',403);
  const old=await tx.projectTimeInvoiceSource.findFirst({where:{id:p.replacesSourceId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,customerId:p.customerId,currency:p.currency},include:{invoice:{select:{id:true,status:true}}}});
  if(!old||old.invoice?.status!=='VOID'||await tx.projectTimeInvoiceSource.count({where:{replacesSourceId:old.id}}))outcome='REPLACEMENT_REQUIRES_LATEST_VOID';
  else if(JSON.stringify((old.entries as {entryId:string}[]).map(e=>e.entryId).sort())!==JSON.stringify(selected.map(e=>e.entryId)))outcome='REPLACEMENT_REQUIRES_SAME_TIME_ENTITLEMENTS';
 }else if(claims.length)outcome='ALREADY_CLAIMED';
 const invoiceDate=date(new Date()),vat=await tx.companyVatProfile.findUnique({where:{companyId:p.companyId}}),vatActive=!!(vat?.enabled&&vat.effectiveFrom&&date(vat.effectiveFrom)<=invoiceDate);
 const prices=projectTimeInvoicePrices(entries,vatActive,p.currency);
 const result={actorId,projectId:project.id,projectName:project.name,projectStatus:project.status,customerId:customer.id,customerName:customer.displayName,customerBranchId:customer.branchId,entries,prices,invoiceDate,vat:vatActive?vat:null,vatActive,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate,replacesSourceId:p.replacesSourceId,outcome};
 const fingerprint={actorId,projectId:project.id,projectName:project.name,projectStatus:project.status,customerId:customer.id,customerName:customer.displayName,customerBranchId:customer.branchId,entries,currency:p.currency,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate,replacesSourceId:p.replacesSourceId,invoiceDate,vatProfileRevision:vat?.revision??null,vatProfile:vat?{...vat,effectiveFrom:vat.effectiveFrom?date(vat.effectiveFrom):null}:null};
 const [sealed]=await tx.$queryRaw<{previewHash:string}[]>`SELECT encode(sha256(convert_to(${JSON.stringify(fingerprint)}::jsonb::text,'UTF8')),'hex') AS "previewHash"`;
 return {...result,previewHash:sealed.previewHash};
}
export async function previewProjectTimeInvoice(actorId:string,p:TimeInvoiceSelection){return db.$transaction(async tx=>{await lock(tx,p);return preview(tx,actorId,p);},options);}
export async function mutateProjectTimeInvoice(actorId:string,input:TimeInvoiceRequest,abandon=false){const p=canonicalTimeInvoiceRequest(input);return db.$transaction(async tx=>{
 await lock(tx,p);await context(tx,actorId,p,true);
 const saved=await tx.projectTimeInvoiceRequest.findUnique({where:{id:p.requestId}});
 const receipt=(row:NonNullable<typeof saved>)=>{if(row.createdBy!==actorId||JSON.stringify(canonicalTimeInvoiceRequest(row.request as TimeInvoiceRequest))!==JSON.stringify(p))throw new BillingError('Request identity belongs to different details');return {actorId,requestId:row.id,request:row.request,result:row.result,outcome:row.outcome};};
 if(saved){if(!abandon&&saved.outcome==='ABANDONED')throw new BillingError('Request permanently abandoned');return receipt(saved);}
 let result:Prisma.InputJsonValue={kind:'abandoned'};
 if(!abandon){
  const view=await preview(tx,actorId,p);
  if(view.previewHash!==p.previewHash)throw new BillingError('Preview changed. Refresh time, customer and tax configuration.');
  if(view.outcome!=='READY')throw new BillingError(view.outcome);
  const id=randomUUID(),invoiceId=randomUUID();
  await tx.projectTimeInvoiceSource.create({data:{id,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,customerId:p.customerId,customerName:view.customerName,currency:p.currency,entries:json(view.entries),lines:json(view.prices.lines),subtotal:view.prices.subtotal,taxAmount:view.prices.taxAmount,vatProfileRevision:view.vat?.revision??null,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate?new Date(p.paymentDueDate):null,replacesSourceId:p.replacesSourceId,reason:p.reason,requestId:p.requestId,createdBy:actorId}});
  if(!p.replacesSourceId)await tx.projectTimeInvoiceClaim.createMany({data:view.entries.map(e=>({entryId:e.entryId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,sourceId:id}))});
  const invoice=await tx.invoice.create({data:{id:invoiceId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:p.customerId,customerName:view.customerName,currency:p.currency,number:'PT-'+BigInt('0x'+id.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0'),projectTimeSourceId:id,subtotal:view.prices.subtotal,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate?new Date(p.paymentDueDate):null,createdBy:actorId,lines:{create:view.prices.lines.map(l=>({position:l.position,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,amount:l.amount}))}}});
  if(view.vatActive&&view.vat)await tx.invoiceVat.create({data:{invoiceId,tenantId:p.tenantId,companyId:p.companyId,taxAmount:view.prices.taxAmount,outputAccountId:view.vat.outputAccountId!,taxNumber:view.vat.taxNumber!,sellerName:view.vat.sellerName!,sellerAddress:view.vat.sellerAddress!,details:view.prices.lines.map(l=>({position:l.position,treatment:l.treatment,net:l.amount,tax:l.tax}))}});
  const link=await tx.projectInvoiceLink.create({data:{id:randomUUID(),tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,invoiceId,note:p.reason,createdBy:actorId}});
  const [txn]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
  await tx.auditLog.create({data:{tenantId:p.tenantId,actorId,action:'project-invoice.linked',entity:'ProjectInvoiceLink',entityId:link.id,metadata:{parentId:p.projectId,requestId:link.id,transaction:txn.transaction}}});
  result={kind:'invoice',projectTimeSourceId:id,invoice:{id:invoice.id,number:invoice.number,status:invoice.status}};
 }
 return receipt(await tx.projectTimeInvoiceRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,request:json(p),result,outcome:abandon?'ABANDONED':'COMMITTED',createdBy:actorId}}));
 },options);}
export async function listProjectTimeInvoices(actorId:string,p:z.infer<typeof projectTimeInvoiceFilters>){return db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 await requireTimeInvoiceSession(tx,actorId);
 if(p.expectedActorId!==actorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadTimeInvoiceAccess(tx,actorId,p.tenantId);
 const branches=(keys:string[])=>keys.reduce<string[]|null>((result,key)=>{const b=access.branches(key,p.companyId);return result===null?b:b===null?result:result.filter(id=>b.includes(id));},null);
 const projectBranches=branches(['project:read','project-time:read','project-time-invoice:read']);
 if(projectBranches?.length===0)throw new BillingError('Project time invoicing read required',403);
 const projectWhere={tenantId:p.tenantId,companyId:p.companyId,...(projectBranches===null?{}:{branchId:{in:projectBranches}})};
 const projects=await tx.project.findMany({where:projectWhere,select:{id:true,code:true,name:true,branchId:true,status:true},orderBy:{id:'asc'},skip:p.page*50,take:51});
 const cb=access.branches('customer:read',p.companyId);
 const customers=await tx.customer.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,...(cb===null?{}:{branchId:{in:cb}})},select:{id:true,displayName:true,branchId:true,archivedAt:true},orderBy:{id:'asc'},skip:p.page*50,take:51});
 if(p.projectId&&!await tx.project.findFirst({where:{...projectWhere,id:p.projectId}}))throw new BillingError('Project unavailable',403);
 const entries=p.projectId?await tx.projectTimeEntry.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,reviewState:'APPROVED',voidedAt:null},select:{id:true,projectId:true,minutes:true,description:true,workDate:true,reviewSequence:true,reviewState:true},orderBy:{id:'asc'},skip:p.page*50,take:51}):[];
 const claims=await tx.projectTimeInvoiceClaim.findMany({where:{entryId:{in:entries.map(e=>e.id)}},select:{entryId:true}});
 const sources=p.projectId?await tx.projectTimeInvoiceSource.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,...(cb===null?{}:{invoice:{customer:{branchId:{in:cb}}}})},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:p.page*50,take:51,include:{invoice:{select:{id:true,number:true,status:true}}}}):[];
 return {actorId,projects:projects.slice(0,50),customers:customers.slice(0,50),entries:entries.slice(0,50).map(e=>({...e,claimed:claims.some(c=>c.entryId===e.id)})),sources:sources.slice(0,50).map(s=>({...s,subtotal:s.subtotal.toFixed(3),taxAmount:s.taxAmount.toFixed(3),invoice:access.can('invoice:read',s)?s.invoice:null})),page:p.page,nextPage:[projects,customers,entries,sources].some(a=>a.length>50)?p.page+1:null,projectsNextPage:projects.length>50?p.page+1:null,customersNextPage:customers.length>50?p.page+1:null,entriesNextPage:entries.length>50?p.page+1:null,sourcesNextPage:sources.length>50?p.page+1:null};
 },options);}
