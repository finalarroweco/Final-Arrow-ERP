import {randomUUID} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {BillingError} from './recurring-billing';
import {loadMilestoneAccess} from './project-milestone-access';
import {milestoneInvoicePrices} from './project-milestone-pricing';
import {canonicalMilestoneInvoiceRequest,type MilestoneInvoiceSelection,type MilestoneInvoiceRequest} from './project-milestone-input';
import {requireMilestoneSession,lockMilestone,milestoneDate,milestoneJson,milestoneTransactionOptions} from './project-milestones';
async function context(tx:Prisma.TransactionClient,actorId:string,p:MilestoneInvoiceSelection,write=false){
 await requireMilestoneSession(tx,actorId);
 if(actorId!==p.expectedActorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadMilestoneAccess(tx,actorId,p.tenantId);
 for(const key of ['project:read','project-milestone:read',...(write?['project-milestone:generate','invoice:read','invoice:create','project-billing:read','project-billing:manage']:[])])if(!access.can(key,p))throw new BillingError('Current project milestone invoicing access required',403);
 const project=await tx.project.findFirst({where:{id:p.projectId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId}});
 const customer=await tx.customer.findFirst({where:{id:p.customerId,tenantId:p.tenantId,companyId:p.companyId}});
 if(!project)throw new BillingError('Project not found',404);
 if(!customer||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Current customer access required',403);
 return {access,project,customer};
}
async function preview(tx:Prisma.TransactionClient,actorId:string,p:MilestoneInvoiceSelection){
 const {project,customer,access}=await context(tx,actorId,p);
 const milestone=await tx.projectMilestone.findFirst({where:{id:p.milestoneId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,branchId:p.branchId}});
 if(!milestone||milestone.status!=='APPROVED'||milestone.sequence!==p.expectedSequence)throw new BillingError('Current approved milestone required');
 if(milestone.customerId!==p.customerId||milestone.currency!==p.currency)throw new BillingError('Original customer and currency required');
 if(!p.replacesSourceId&&(milestone.agreedPrice.toFixed(3)!==p.agreedPrice||milestone.treatment!==p.treatment||milestone.paymentTerms!==p.paymentTerms||(milestone.paymentDueDate?milestoneDate(milestone.paymentDueDate):null)!==p.paymentDueDate))throw new BillingError('Original approved milestone agreement required');
 let outcome='READY';
 if(project.status==='CANCELLED'&&!p.replacesSourceId||customer.archivedAt)outcome='UNAVAILABLE';
 if(p.replacesSourceId){
  if(!access.can('invoice:read',p))throw new BillingError('Invoice read required',403);
  const old=await tx.projectMilestoneInvoiceSource.findFirst({where:{id:p.replacesSourceId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,milestoneId:p.milestoneId,customerId:p.customerId,currency:p.currency},include:{invoice:{select:{id:true,status:true}}}});
  if(!old||old.invoice?.status!=='VOID'||await tx.projectMilestoneInvoiceSource.count({where:{replacesSourceId:old.id}}))outcome='REPLACEMENT_REQUIRES_LATEST_VOID';
  else {const [check]=await tx.$queryRaw<{reversed:boolean}[]>`SELECT erp_milestone_invoice_reversed(${old.invoice.id}::uuid) AS reversed`;if(!check.reversed)outcome='REPLACEMENT_REQUIRES_REVERSED_DEPENDENCIES';}
 }else if(await tx.projectMilestoneInvoiceClaim.findUnique({where:{milestoneId:p.milestoneId}}))outcome='ALREADY_CLAIMED';
 const invoiceDate=milestoneDate(new Date()),vat=await tx.companyVatProfile.findUnique({where:{companyId:p.companyId}}),vatActive=!!(vat?.enabled&&vat.effectiveFrom&&milestoneDate(vat.effectiveFrom)<=invoiceDate);
 const prices=milestoneInvoicePrices({description:milestone.description,agreedPrice:p.agreedPrice,treatment:p.treatment},vatActive,p.currency);
 const result={actorId,projectId:project.id,projectName:project.name,projectStatus:project.status,customerId:customer.id,customerName:customer.displayName,customerBranchId:customer.branchId,milestoneId:milestone.id,description:milestone.description,agreedPrice:p.agreedPrice,treatment:p.treatment,prices,invoiceDate,vat:vatActive?vat:null,vatActive,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate,replacesSourceId:p.replacesSourceId,outcome};
 const fingerprint={actorId,projectId:project.id,projectName:project.name,projectStatus:project.status,customerId:customer.id,customerName:customer.displayName,customerBranchId:customer.branchId,milestoneId:milestone.id,description:milestone.description,sequence:milestone.sequence,agreedPrice:p.agreedPrice,treatment:p.treatment,currency:p.currency,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate,replacesSourceId:p.replacesSourceId,invoiceDate,vatProfileRevision:vat?.revision??null,vatProfile:vat?{...vat,effectiveFrom:vat.effectiveFrom?milestoneDate(vat.effectiveFrom):null}:null};
 const [sealed]=await tx.$queryRaw<{previewHash:string}[]>`SELECT encode(sha256(convert_to(${JSON.stringify(fingerprint)}::jsonb::text,'UTF8')),'hex') AS "previewHash"`;
 return {...result,previewHash:sealed.previewHash};
}
export async function previewMilestoneInvoice(actorId:string,p:MilestoneInvoiceSelection){return db.$transaction(async tx=>{await lockMilestone(tx,p);return preview(tx,actorId,p);},milestoneTransactionOptions);}
export async function mutateMilestoneInvoice(actorId:string,input:MilestoneInvoiceRequest,abandon=false){const p=canonicalMilestoneInvoiceRequest(input);return db.$transaction(async tx=>{
 await lockMilestone(tx,p);await context(tx,actorId,p,true);
 const saved=await tx.projectMilestoneInvoiceRequest.findUnique({where:{id:p.requestId}});
 const receipt=(row:NonNullable<typeof saved>)=>{if(row.createdBy!==actorId||JSON.stringify(canonicalMilestoneInvoiceRequest(row.request as MilestoneInvoiceRequest))!==JSON.stringify(p))throw new BillingError('Request identity belongs to different details');return {actorId,requestId:row.id,request:row.request,result:row.result,outcome:row.outcome};};
 if(saved){if(!abandon&&saved.outcome==='ABANDONED')throw new BillingError('Request permanently abandoned');return receipt(saved);}
 let result:Prisma.InputJsonValue={kind:'abandoned'};
 if(!abandon){
  const view=await preview(tx,actorId,p);
  if(view.previewHash!==p.previewHash)throw new BillingError('Preview changed. Refresh milestone, customer and tax configuration.');
  if(view.outcome!=='READY')throw new BillingError(view.outcome);
  const id=randomUUID(),invoiceId=randomUUID();
  await tx.projectMilestoneInvoiceSource.create({data:{id,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,customerId:p.customerId,customerName:view.customerName,currency:p.currency,milestoneId:p.milestoneId,description:view.description,agreedPrice:p.agreedPrice,treatment:p.treatment,lines:milestoneJson(view.prices.lines),subtotal:view.prices.subtotal,taxAmount:view.prices.taxAmount,vatProfileRevision:view.vat?.revision??null,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate?new Date(p.paymentDueDate):null,replacesSourceId:p.replacesSourceId,reason:p.reason,requestId:p.requestId,createdBy:actorId}});
  if(!p.replacesSourceId)await tx.projectMilestoneInvoiceClaim.create({data:{milestoneId:p.milestoneId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,sourceId:id}});
  const invoice=await tx.invoice.create({data:{id:invoiceId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:p.customerId,customerName:view.customerName,currency:p.currency,number:'PM-'+BigInt('0x'+id.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0'),projectMilestoneSourceId:id,subtotal:view.prices.subtotal,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate?new Date(p.paymentDueDate):null,createdBy:actorId,lines:{create:view.prices.lines.map(l=>({position:l.position,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,amount:l.amount}))}}});
  if(view.vatActive&&view.vat)await tx.invoiceVat.create({data:{invoiceId,tenantId:p.tenantId,companyId:p.companyId,taxAmount:view.prices.taxAmount,outputAccountId:view.vat.outputAccountId!,taxNumber:view.vat.taxNumber!,sellerName:view.vat.sellerName!,sellerAddress:view.vat.sellerAddress!,details:view.prices.lines.map(l=>({position:l.position,treatment:l.treatment,net:l.amount,tax:l.tax}))}});
  const link=await tx.projectInvoiceLink.create({data:{id:randomUUID(),tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,invoiceId,note:p.reason,createdBy:actorId}});
  const [txn]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
  await tx.auditLog.create({data:{tenantId:p.tenantId,actorId,action:'project-invoice.linked',entity:'ProjectInvoiceLink',entityId:link.id,metadata:{parentId:p.projectId,requestId:link.id,transaction:txn.transaction}}});
  result={kind:'invoice',projectMilestoneSourceId:id,invoice:{id:invoice.id,number:invoice.number,status:invoice.status}};
 }
 return receipt(await tx.projectMilestoneInvoiceRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,request:milestoneJson(p),result,outcome:abandon?'ABANDONED':'COMMITTED',createdBy:actorId}}));
 },milestoneTransactionOptions);}
