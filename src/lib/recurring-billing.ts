import {createHash,randomUUID} from 'node:crypto';
import {Prisma,type BillingRequest} from '@prisma/client';
import {db} from './db';
import {loadBillingAccess} from './recurring-access';
import {billingSourceView} from './recurring-source-view';
import {billingBoundary,billingPeriod,billingDueDate,billingPeriodCount,type BillingCadence,type BillingTerms} from './recurring-calendar';
import {billingPriceSnapshot,type BillingPriceLine} from './recurring-pricing';
import {canonicalRecurringRequest,recurringRequest,recurringCadence,recurringTerms,type RecurringRequest,type RecurringGenerateRequest,recurringPreviewRequest,recurringFilters} from './recurring-input';
import type {z} from 'zod';
export class BillingError extends Error {constructor(message:string,public status=409){super(message);}}
const options={timeout:30000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
const date=(d:Date)=>d.toISOString().slice(0,10);
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const serviceInvoiceNumber=(id:string)=>`SUB-${BigInt('0x'+id.replaceAll('-','')).toString(36).toUpperCase().padStart(25,'0')}`;
async function locks(tx:Prisma.TransactionClient,p:{tenantId:string;companyId:string;customerId?:string;subscriptionId?:string;planId?:string;periodIndex?:number;requestId?:string}){
 // Global order: tenant SHARE, company UPDATE (before VAT), customer SHARE,
 // subscription/plan advisory, period advisory, request advisory. Never invert.
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${p.companyId}::uuid AND "tenantId"=${p.tenantId}::uuid FOR UPDATE`;
 if(p.customerId)await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${p.customerId}::uuid AND "tenantId"=${p.tenantId}::uuid AND "companyId"=${p.companyId}::uuid FOR SHARE`;
 if(p.subscriptionId||p.planId)await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'billing-object:'+(p.subscriptionId??p.planId)},0))`;
 if(p.periodIndex!==undefined)await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'billing-period:'+p.subscriptionId+':'+p.periodIndex},0))`;
 if(p.requestId)await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'billing-request:'+p.requestId},0))`;
}
function receipt(saved:BillingRequest,p:RecurringRequest){
 if(saved.createdBy!==p.expectedActorId||JSON.stringify(canonicalRecurringRequest(recurringRequest.parse(saved.request)))!==JSON.stringify(canonicalRecurringRequest(p)))throw new BillingError('Request identity belongs to different details');
 return {requestId:saved.id,actorId:saved.createdBy,outcome:saved.outcome,request:saved.request,result:saved.result,createdAt:saved.createdAt.toISOString()};
}
async function accessFor(tx:Prisma.TransactionClient,actorId:string,p:{tenantId:string;companyId:string;branchId:string|null;expectedActorId:string},permission:string){
 if(p.expectedActorId!==actorId)throw new BillingError('Saved request belongs to a different signed-in user',403);
 const access=await loadBillingAccess(tx,actorId,p.tenantId);
 if(!access.can('billing-subscription:read',p)||!access.can(permission,p))throw new BillingError('Billing scope access required',403);return access;
}
async function subscriptionContext(tx:Prisma.TransactionClient,actorId:string,p:{tenantId:string;companyId:string;branchId:string|null;expectedActorId:string;subscriptionId:string},permission:string){
 const access=await accessFor(tx,actorId,p,permission);
 const subscription=await tx.billingSubscription.findFirst({where:{id:p.subscriptionId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId},include:{revisions:{orderBy:{version:'desc'},take:1}}});
 if(!subscription)throw new BillingError('Billing subscription not found',404);
 const customer=await tx.customer.findFirst({where:{id:subscription.customerId,tenantId:p.tenantId,companyId:p.companyId}});
 if(!customer||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Customer access required',403);
 return {access,subscription,customer};
}
async function periodPreview(tx:Prisma.TransactionClient,actorId:string,p:z.infer<typeof recurringPreviewRequest>,index:number){
 const {access,subscription,customer}=await subscriptionContext(tx,actorId,p,'billing-subscription:read');
 if(p.replacesSourceId&&!access.can('invoice:read',p))throw new BillingError('Invoice read access required for correction preview',403);
 const revision=await tx.billingSubscriptionRevision.findFirst({where:{subscriptionId:subscription.id,effectivePeriod:{lte:index}},orderBy:{version:'desc'}});
 if(!revision)throw new BillingError('No configuration for this period');
 const plan=await tx.billingPlanRevision.findUniqueOrThrow({where:{id:p.replacesSourceId?p.replacementPlanRevisionId??revision.planRevisionId:revision.planRevisionId}}),planHead=await tx.billingPlan.findUniqueOrThrow({where:{id:plan.planId}});
 if(plan.tenantId!==p.tenantId||plan.companyId!==p.companyId||plan.branchId!==null&&plan.branchId!==p.branchId||plan.currency!==subscription.currency||!access.can('billing-subscription:read',planHead))throw new BillingError('Plan access required',403);
 const period=billingPeriod(date(subscription.anchor),recurringCadence.parse(subscription.cadence) as BillingCadence,index),horizon=date(revision.horizon),today=date(new Date());
 const profile=await tx.companyVatProfile.findUnique({where:{companyId:p.companyId}});
 const vatActive=!!(profile?.enabled&&profile.effectiveFrom&&date(profile.effectiveFrom)<=today);
 const prices=billingPriceSnapshot(plan.lines as BillingPriceLine[],vatActive,subscription.currency);
 const dueDate=billingDueDate(period,recurringTerms.parse(revision.terms) as BillingTerms);
 const sources=await tx.serviceInvoiceSource.findMany({where:{subscriptionId:subscription.id,periodIndex:index,...(p.replacesSourceId?{}:{correctionIndex:0})},orderBy:{correctionIndex:'desc'},take:1,include:{invoice:{select:{id:true,number:true,status:true}}}});
 const original=p.replacesSourceId?sources.find(s=>s.id===p.replacesSourceId):null;
 let outcome='READY';
 if(subscription.archived||planHead.archived||plan.archived||revision.archived||customer.archivedAt)outcome='ARCHIVED';
 else if(period.start>=horizon)outcome='OUTSIDE_HORIZON';
 else if(period.end>horizon)outcome='PARTIAL_REVIEW';
 else if(revision.status!=='ACTIVE'&&!p.replacesSourceId&&!(p.backfill&&period.end<=today))outcome='SKIPPED';
 else if(p.backfill&&period.end>today)outcome='BACKFILL_REQUIRES_PAST_PERIOD';
 else if(period.start>today)outcome='FUTURE';
 else if(p.replacesSourceId){if(!original||sources[0]?.id!==original.id||original.invoice?.status!=='VOID')outcome='REPLACEMENT_REQUIRES_LATEST_VOID';}
 else if(sources.length)outcome='GENERATED';
 else if(period.end<=today&&!p.backfill)outcome='BACKFILL_REQUIRED';
 const snapshot={subscriptionId:subscription.id,subscriptionVersion:subscription.version,subscriptionRevisionId:revision.id,planRevisionId:plan.id,planVersion:plan.version,planLabel:plan.label,customerId:customer.id,customerName:customer.displayName,customerBranchId:customer.branchId,period,horizon,status:revision.status,currency:subscription.currency,prices,terms:revision.terms,paymentDueDate:dueDate,today,vat:vatActive?profile:null,vatActive,backfill:p.backfill,replacesSourceId:p.replacesSourceId,replacementPlanRevisionId:p.replacementPlanRevisionId,correctionIndex:original?original.correctionIndex+1:0,outcome,existingSourceId:sources[0]?.id??null,invoice:access.can('invoice:read',p)?sources[0]?.invoice??null:null};
 return {...snapshot,previewHash:hash(snapshot)};
}
export async function previewRecurringBilling(actorId:string,p:z.infer<typeof recurringPreviewRequest>){return db.$transaction(async tx=>{
 const identity=await tx.billingSubscription.findFirst({where:{id:p.subscriptionId,tenantId:p.tenantId,companyId:p.companyId},select:{customerId:true}});
 await locks(tx,{...p,customerId:identity?.customerId});
 const {subscription}=await subscriptionContext(tx,actorId,p,'billing-subscription:read');
 const latest=subscription.revisions[0];if(!latest)throw new BillingError('No configuration');
 const totalPeriods=billingPeriodCount(date(subscription.anchor),recurringCadence.parse(subscription.cadence),date(latest.horizon));
 if(p.offset>=totalPeriods)return {actorId,subscriptionVersion:subscription.version,periods:[],nextOffset:null,count:0,totalPeriods,outcomeCounts:{},complete:true};
 const rows=[];let index=p.offset;
 for(;rows.length<p.limit;index++){
  if(billingBoundary(date(subscription.anchor),recurringCadence.parse(subscription.cadence),index)>=date(latest.horizon))break;
  rows.push(await periodPreview(tx,actorId,p,index));
 }
 const nextOffset=billingBoundary(date(subscription.anchor),recurringCadence.parse(subscription.cadence),index)<date(latest.horizon)?index:null;
 return {actorId,subscriptionVersion:subscription.version,periods:rows,nextOffset,count:rows.length,totalPeriods,outcomeCounts:rows.reduce<Record<string,number>>((counts,row)=>{counts[row.outcome]=(counts[row.outcome]??0)+1;return counts;},{}),complete:nextOffset===null};
 },options);}
async function generate(tx:Prisma.TransactionClient,actorId:string,p:RecurringGenerateRequest){
 const {access,subscription}=await subscriptionContext(tx,actorId,p,'billing-subscription:generate');
 if(!access.can('invoice:create',p)||!access.can('invoice:read',p))throw new BillingError('Invoice create/read scope required',403);
 if(subscription.version!==p.expectedVersion)throw new BillingError('Configuration changed. Refresh preview.');
 const preview=await periodPreview(tx,actorId,{...p,offset:p.periodIndex,limit:1,backfill:p.action==='backfill',replacesSourceId:p.replacesSourceId,replacementPlanRevisionId:p.replacementPlanRevisionId},p.periodIndex);
 if(preview.previewHash!==p.previewHash)throw new BillingError('Preview is stale. Refresh prices, calendar and VAT before generating.');
 if(preview.outcome==='GENERATED')return {kind:'invoice',subscriptionId:p.subscriptionId,periodIndex:p.periodIndex,serviceSourceId:preview.existingSourceId,invoice:preview.invoice,alreadyGenerated:true};
 if(preview.outcome!=='READY')throw new BillingError('Period cannot be generated: '+preview.outcome);
 const id=randomUUID(),invoiceId=randomUUID();
 await tx.serviceInvoiceSource.create({data:{id,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:preview.customerId,customerName:preview.customerName,subscriptionId:p.subscriptionId,subscriptionRevisionId:preview.subscriptionRevisionId,planRevisionId:preview.planRevisionId,periodIndex:p.periodIndex,periodStart:new Date(preview.period.start),periodEnd:new Date(preview.period.end),correctionIndex:preview.correctionIndex,replacesSourceId:p.replacesSourceId,currency:preview.currency,lines:json(preview.prices.lines),subtotal:preview.prices.subtotal,taxAmount:preview.prices.taxAmount,vatProfileRevision:preview.vat?.revision??null,paymentTerms:(preview.terms as BillingTerms).kind==='OFFSET'?(preview.terms as Extract<BillingTerms,{kind:'OFFSET'}>).label:null,paymentDueDate:preview.paymentDueDate?new Date(preview.paymentDueDate):null,reason:p.reason,requestId:p.requestId,createdBy:actorId}});
 const invoice=await tx.invoice.create({data:{id:invoiceId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:preview.customerId,customerName:preview.customerName,orderId:null,serviceSourceId:id,number:serviceInvoiceNumber(id),currency:preview.currency,subtotal:preview.prices.subtotal,paymentTerms:(preview.terms as BillingTerms).kind==='OFFSET'?(preview.terms as Extract<BillingTerms,{kind:'OFFSET'}>).label:null,paymentDueDate:preview.paymentDueDate?new Date(preview.paymentDueDate):null,createdBy:actorId,lines:{create:preview.prices.lines.map(l=>({position:l.position,description:l.description,quantity:l.quantity,unitPrice:l.unitPrice,amount:l.amount}))}}});
 if(preview.vatActive&&preview.vat)await tx.invoiceVat.create({data:{invoiceId,tenantId:p.tenantId,companyId:p.companyId,taxAmount:preview.prices.taxAmount,outputAccountId:preview.vat.outputAccountId!,taxNumber:preview.vat.taxNumber!,sellerName:preview.vat.sellerName!,sellerAddress:preview.vat.sellerAddress!,details:preview.prices.lines.map(l=>({position:l.position,treatment:l.treatment,net:l.amount,tax:l.tax}))}});
 await tx.auditLog.create({data:{tenantId:p.tenantId,actorId,action:'invoice.created',entity:'Invoice',entityId:invoice.id,metadata:{serviceSourceId:id,requestId:p.requestId,subscriptionId:p.subscriptionId,periodIndex:p.periodIndex,subtotal:preview.prices.subtotal,currency:preview.currency}}});
 return {kind:'invoice',subscriptionId:p.subscriptionId,periodIndex:p.periodIndex,serviceSourceId:id,invoice:{id:invoice.id,number:invoice.number,status:invoice.status},alreadyGenerated:false};
}
export async function mutateRecurringBilling(actorId:string,p:RecurringRequest,abandon=false){return db.$transaction(async tx=>{
 const identity='subscriptionId'in p?await tx.billingSubscription.findFirst({where:{id:p.subscriptionId,tenantId:p.tenantId,companyId:p.companyId},select:{customerId:true}}):null;
 await locks(tx,{...p,customerId:'customerId'in p?p.customerId:identity?.customerId});
 const permission=p.action==='plan'||p.action==='configure'?'billing-subscription:manage':'billing-subscription:generate';
 const access=await accessFor(tx,actorId,p,permission);
 if('subscriptionId'in p&&p.action!=='configure')await subscriptionContext(tx,actorId,p,permission);
 if(p.action==='generate'||p.action==='backfill'||p.action==='replace')if(!access.can('invoice:read',p)||!access.can('invoice:create',p))throw new BillingError('Current invoice read/create access required',403);
 if(p.action==='configure'){
  const customer=await tx.customer.findFirst({where:{id:p.customerId,tenantId:p.tenantId,companyId:p.companyId}});
  if(!customer||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Current customer access required',403);
  if(p.manualSubscriptionId){const manual=await tx.manualSubscription.findFirst({where:{id:p.manualSubscriptionId,tenantId:p.tenantId,companyId:p.companyId,customerId:p.customerId,branchId:p.branchId}});if(!manual||!access.can('subscription:read',manual))throw new BillingError('Manual navigation link is unavailable',403);}
 }

 const saved=await tx.billingRequest.findUnique({where:{id:p.requestId}});
 if(saved){const result=receipt(saved,p);if(!abandon&&saved.outcome==='ABANDONED')throw new BillingError('Request was permanently abandoned. Prepare a new request.');return result;}
 let result:unknown={kind:'abandoned'};
 if(!abandon&&p.action==='plan'){
  billingPriceSnapshot(p.lines,false,p.currency);
  const existing=await tx.billingPlan.findUnique({where:{id:p.planId}});
  if(existing&&(existing.tenantId!==p.tenantId||existing.companyId!==p.companyId||existing.branchId!==p.branchId||existing.currency!==p.currency))throw new BillingError('Plan ownership and currency are immutable');
  if((existing?.version??0)!==p.expectedVersion)throw new BillingError('Plan version changed');
  const version=p.expectedVersion+1;
  if(existing)await tx.billingPlan.update({where:{id:p.planId},data:{version,label:p.label,archived:p.archived,updatedAt:new Date()}});
  else await tx.billingPlan.create({data:{id:p.planId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,version,label:p.label,currency:p.currency,archived:p.archived,createdBy:actorId}});
  const event=await tx.billingPlanRevision.create({data:{id:randomUUID(),tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,planId:p.planId,version,label:p.label,currency:p.currency,lines:p.lines,archived:p.archived,reason:p.reason,requestId:p.requestId,createdBy:actorId}});
  result={kind:'plan',planId:p.planId,revisionId:event.id,version};
 }else if(!abandon&&p.action==='configure'){
  const customer=await tx.customer.findFirst({where:{id:p.customerId,tenantId:p.tenantId,companyId:p.companyId}});
  if(!customer||customer.archivedAt||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Current customer access required',403);
  const plan=await tx.billingPlan.findFirst({where:{id:p.planId,tenantId:p.tenantId,companyId:p.companyId},include:{revisions:{where:{version:p.planVersion}}}});
  if(!plan||plan.archived||plan.branchId!==null&&plan.branchId!==p.branchId||!access.can('billing-subscription:read',plan)||plan.revisions.length!==1||plan.revisions[0]?.archived)throw new BillingError('An available plan version is required');
  const existing=await tx.billingSubscription.findUnique({where:{id:p.subscriptionId},include:{revisions:{orderBy:{version:'desc'},take:1},sources:{orderBy:{periodIndex:'desc'},take:1}}});
  if((existing?.version??0)!==p.expectedVersion)throw new BillingError('Subscription configuration changed');
  if(existing&&(existing.tenantId!==p.tenantId||existing.companyId!==p.companyId||existing.branchId!==p.branchId||existing.customerId!==p.customerId||existing.manualSubscriptionId!==p.manualSubscriptionId||date(existing.anchor)!==p.anchor||JSON.stringify(recurringCadence.parse(existing.cadence))!==JSON.stringify(p.cadence)||existing.currency!==plan.currency))throw new BillingError('Customer, scope, anchor, cadence, currency and manual navigation link are immutable');
  if(!existing&&p.effectivePeriod!==0)throw new BillingError('Initial configuration must start at period zero');
  if(existing&&(p.effectivePeriod<(existing.revisions[0]?.effectivePeriod??0)||p.effectivePeriod<=(existing.sources[0]?.periodIndex??-1)))throw new BillingError('Configuration requires an ungenerated future boundary');
  if(billingBoundary(p.anchor,p.cadence,p.effectivePeriod)>=p.horizon)throw new BillingError('Horizon must extend past the effective boundary');
  if(p.manualSubscriptionId){const manual=await tx.manualSubscription.findFirst({where:{id:p.manualSubscriptionId,tenantId:p.tenantId,companyId:p.companyId,customerId:p.customerId,branchId:p.branchId}});if(!manual||!access.can('subscription:read',manual))throw new BillingError('Manual navigation link is unavailable',403);}
  const version=p.expectedVersion+1;
  if(existing)await tx.billingSubscription.update({where:{id:p.subscriptionId},data:{version,archived:p.archived,updatedAt:new Date()}});
  else await tx.billingSubscription.create({data:{id:p.subscriptionId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,customerId:p.customerId,manualSubscriptionId:p.manualSubscriptionId,anchor:new Date(p.anchor),cadence:p.cadence,currency:plan.currency,version,archived:p.archived,createdBy:actorId}});
  const event=await tx.billingSubscriptionRevision.create({data:{id:randomUUID(),tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,subscriptionId:p.subscriptionId,version,effectivePeriod:p.effectivePeriod,planRevisionId:plan.revisions[0].id,horizon:new Date(p.horizon),status:p.status,terms:p.terms,archived:p.archived,reason:p.reason,requestId:p.requestId,createdBy:actorId}});
  result={kind:'configuration',subscriptionId:p.subscriptionId,revisionId:event.id,version};
 }else if(!abandon&&p.action!=='plan'&&p.action!=='configure')result=await generate(tx,actorId,p);
 const row=await tx.billingRequest.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,action:p.action,request:canonicalRecurringRequest(p),result:json(result),outcome:abandon?'ABANDONED':'COMMITTED',createdBy:actorId}});
 return receipt(row,p);
 },options);}
export async function listRecurringBilling(actorId:string,p:z.infer<typeof recurringFilters>){return db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 if(p.expectedActorId!==actorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadBillingAccess(tx,actorId,p.tenantId),branches=access.branches('billing-subscription:read',p.companyId),customers=access.branches('customer:read',p.companyId);
 if(branches!==null&&!branches.length)throw new BillingError('Billing read access required',403);
 const where={tenantId:p.tenantId,companyId:p.companyId,AND:[...(branches===null?[]:[{branchId:{in:branches}}]),...(p.branchId?[{branchId:p.branchId==='company'?null:p.branchId}]:[])]};
 const customerRows=await tx.customer.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,...(customers===null?{}:{branchId:{in:customers}})},select:{id:true,displayName:true,branchId:true,archivedAt:true},take:5001});
 if(customerRows.length>5000)throw new BillingError('Customer selector exceeds 5000 records',413);
 const [plans,subscriptions]=await Promise.all([
  tx.billingPlan.findMany({where,include:{revisions:{orderBy:{version:'desc'},take:1}},orderBy:{id:'asc'},skip:p.page*50,take:51}),
  tx.billingSubscription.findMany({where:{...where,customerId:{in:customerRows.map(c=>c.id)}},include:{revisions:{orderBy:{version:'desc'},take:1},sources:{orderBy:{createdAt:'desc'},take:10,select:{id:true,subscriptionId:true,tenantId:true,companyId:true,branchId:true,periodIndex:true,periodStart:true,periodEnd:true,correctionIndex:true,replacesSourceId:true,reason:true,currency:true,subtotal:true,taxAmount:true,paymentTerms:true,paymentDueDate:true,createdAt:true,createdBy:true,invoice:{select:{id:true,number:true,status:true}}}}},orderBy:{id:'asc'},skip:p.page*50,take:51})]);
 return {actorId,plans:plans.slice(0,50).map(plan=>({...plan,historyMayContinue:plan.version>1})),subscriptions:subscriptions.slice(0,50).map(subscription=>({...subscription,manualSubscriptionId:access.can('subscription:read',subscription)?subscription.manualSubscriptionId:null,manualLinkRestricted:!!subscription.manualSubscriptionId&&!access.can('subscription:read',subscription),historyMayContinue:subscription.version>1,sourcesMayContinue:subscription.sources.length===10,sources:subscription.sources.map(source=>({...billingSourceView(source),invoice:access.can('invoice:read',subscription)?source.invoice:null}))})),customers:customerRows,page:p.page,nextPage:plans.length>50||subscriptions.length>50?p.page+1:null};
 },options);}
export async function recurringBillingHistory(actorId:string,p:{tenantId:string;companyId:string;branchId:string;expectedActorId:string;kind:'plan'|'subscription';id:string;page:number}){return db.$transaction(async tx=>{
 const scope={...p,branchId:p.branchId==='company'?null:p.branchId};
 const identity=p.kind==='subscription'?await tx.billingSubscription.findFirst({where:{id:p.id,tenantId:p.tenantId,companyId:p.companyId},select:{customerId:true}}):null;
 await locks(tx,{...p,customerId:identity?.customerId,...(p.kind==='subscription'?{subscriptionId:p.id}:{planId:p.id})});
 const access=await accessFor(tx,actorId,scope,'billing-subscription:read');
 if(p.kind==='plan'){
  const head=await tx.billingPlan.findFirst({where:{id:p.id,tenantId:p.tenantId,companyId:p.companyId,branchId:scope.branchId}});if(!head)throw new BillingError('Plan not found',404);
  const revisions=await tx.billingPlanRevision.findMany({where:{planId:p.id},orderBy:{version:'desc'},skip:p.page*50,take:51});
  return {actorId,kind:p.kind,id:p.id,page:p.page,nextPage:revisions.length>50?p.page+1:null,revisions:revisions.slice(0,50),sources:[],revisionsNextPage:revisions.length>50?p.page+1:null,sourcesNextPage:null};
 }
 await subscriptionContext(tx,actorId,{...scope,subscriptionId:p.id},'billing-subscription:read');
 const [revisions,sources]=await Promise.all([
  tx.billingSubscriptionRevision.findMany({where:{subscriptionId:p.id},orderBy:{version:'desc'},skip:p.page*50,take:51}),
  tx.serviceInvoiceSource.findMany({where:{subscriptionId:p.id},orderBy:[{periodIndex:'desc'},{correctionIndex:'desc'}],skip:p.page*50,take:51,include:{invoice:{select:{id:true,number:true,status:true}}}})]);
 return {actorId,kind:p.kind,id:p.id,page:p.page,nextPage:revisions.length>50||sources.length>50?p.page+1:null,revisions:revisions.slice(0,50),sources:sources.slice(0,50).map(source=>({...billingSourceView(source),invoice:access.can('invoice:read',scope)?source.invoice:null})),revisionsNextPage:revisions.length>50?p.page+1:null,sourcesNextPage:sources.length>50?p.page+1:null};
 },options);}
