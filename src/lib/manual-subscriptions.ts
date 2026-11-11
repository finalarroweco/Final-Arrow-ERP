import {Prisma,type ManualSubscriptionRequest} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {loadSubscriptionAccess} from './manual-subscription-access';
import {canonicalSubscriptionRequest,subscriptionResponseMatches,subscriptionCancellationMatches,subscriptionEvent,subscriptionFilters,type SubscriptionRequest} from './manual-subscription-input';
export class SubscriptionError extends Error{constructor(message:string,public status=409){super(message);}}
const transactionOptions={timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
function cancellation(row:ManualSubscriptionRequest){return {id:row.id,tenantId:row.tenantId,companyId:row.companyId,branchId:row.branchId,subscriptionId:row.subscriptionId,customerId:row.customerId,createdBy:row.createdBy,createdAt:row.createdAt.toISOString(),request:row.request};}
function savedResult(row:ManualSubscriptionRequest,input:SubscriptionRequest){
 if(JSON.stringify(canonicalSubscriptionRequest(input))!==JSON.stringify(canonicalSubscriptionRequest(row.request as SubscriptionRequest))||row.createdBy!==input.expectedActorId)throw new SubscriptionError('Request identity belongs to different details');
 if(row.outcome==='ABANDONED'){const c=cancellation(row);if(!subscriptionCancellationMatches(input,c))throw new SubscriptionError('Invalid saved cancellation');return {cancellation:c};}
 const event=subscriptionEvent.parse(row.result);if(!subscriptionResponseMatches(input,event))throw new SubscriptionError('Invalid saved subscription receipt');return {event};
}
export async function mutateManualSubscription(actorId:string,input:SubscriptionRequest,abandon=false){return db.$transaction(async tx=>{
 await tenantLock(tx,input.tenantId);
 if(input.expectedActorId!==actorId)throw new SubscriptionError('Saved request belongs to a different signed-in user',403);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'manual-subscription-request:'+input.requestId},0))`;
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${input.customerId}::uuid AND "tenantId"=${input.tenantId}::uuid AND "companyId"=${input.companyId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'manual-subscription:'+input.subscriptionId},0))`;
 const access=await loadSubscriptionAccess(tx,actorId,input.tenantId);
 const customer=await tx.customer.findFirst({where:{id:input.customerId,tenantId:input.tenantId,companyId:input.companyId},select:{id:true,companyId:true,branchId:true}});
 if(!access.canManage(input)||!customer||!access.canReadCustomer(customer)||customer.branchId!==null&&customer.branchId!==input.branchId)throw new SubscriptionError('Subscription and customer access required',403);
 const saved=await tx.manualSubscriptionRequest.findUnique({where:{id:input.requestId}});
 if(saved){const result=savedResult(saved,input);if(!abandon&&'cancellation'in result)throw new SubscriptionError('Request was permanently abandoned. Prepare a new request.');return result;}
 const row=await tx.manualSubscriptionRequest.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,branchId:input.branchId,subscriptionId:input.subscriptionId,customerId:input.customerId,createdBy:actorId,action:input.action,expectedVersion:input.expectedVersion,request:canonicalSubscriptionRequest(input),outcome:abandon?'ABANDONED':'COMMITTED'}});
 return savedResult(row,input);
 },transactionOptions);}
const dateString=(value:Date|null)=>value?value.toISOString().slice(0,10):null;
export function subscriptionView<T extends {startDate:Date|null;endDate:Date|null;nextReviewDate:Date|null}>(row:T){return {...row,startDate:dateString(row.startDate),endDate:dateString(row.endDate),nextReviewDate:dateString(row.nextReviewDate)};}
export async function listManualSubscriptions(actorId:string,f:z.infer<typeof subscriptionFilters>){return db.$transaction(async tx=>{
 await tenantLock(tx,f.tenantId);
 const access=await loadSubscriptionAccess(tx,actorId,f.tenantId),readable=access.readableBranches(f.companyId),customers=access.customerBranches(f.companyId);
 if(readable!==null&&!readable.length)throw new SubscriptionError('Subscription read access required',403);
 if(f.branchId&&!access.canRead({companyId:f.companyId,branchId:f.branchId==='company'?null:f.branchId}))throw new SubscriptionError('Subscription scope access required',403);
 const where:Prisma.ManualSubscriptionWhereInput={tenantId:f.tenantId,companyId:f.companyId,AND:[...(readable===null?[]:[{branchId:{in:readable}}]),...(f.branchId?[{branchId:f.branchId==='company'?null:f.branchId}]:[]),{customer:{tenantId:f.tenantId,companyId:f.companyId,...(customers===null?{}:{branchId:{in:customers}})}}],...(f.state==='ALL'?{}:{archived:f.state==='ARCHIVED'}),...(f.status?{status:f.status}:{}),...(f.reviewFrom||f.reviewTo?{nextReviewDate:{...(f.reviewFrom?{gte:new Date(f.reviewFrom)}:{}),...(f.reviewTo?{lte:new Date(f.reviewTo)}:{})}}:{}),...(f.q?{OR:[{serviceLabel:{contains:f.q,mode:'insensitive'}},{description:{contains:f.q,mode:'insensitive'}},{reference:{contains:f.q,mode:'insensitive'}},{agreementReference:{contains:f.q,mode:'insensitive'}},{customerName:{contains:f.q,mode:'insensitive'}},{customerCode:{contains:f.q,mode:'insensitive'}}]}:{})};
 const rows=await tx.manualSubscription.findMany({where,select:{id:true,tenantId:true,companyId:true,branchId:true,customerId:true,customerBranchId:true,customerName:true,customerCode:true,reference:true,serviceLabel:true,agreementReference:true,status:true,startDate:true,endDate:true,nextReviewDate:true,version:true,archived:true,createdBy:true,createdAt:true,updatedAt:true},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:f.format==='csv'?0:f.page*50,take:f.format==='csv'?5001:51});
 if(f.format==='csv'&&rows.length>5000)throw new SubscriptionError('Export exceeds 5000 subscriptions. Narrow the filters.',413);
 return {subscriptions:rows.slice(0,f.format==='csv'?5000:50).map(subscriptionView),page:f.page,nextPage:f.format==='json'&&rows.length>50?f.page+1:null};
 },transactionOptions);}
export async function readManualSubscription(actorId:string,id:string,scope:{tenantId:string;companyId:string},page=0,eventId?:string){return db.$transaction(async tx=>{
 const ownedScope={tenantId:scope.tenantId,companyId:scope.companyId};
 await tenantLock(tx,scope.tenantId);
 // Source identity is immutable. Lock source before projection, matching mutation order.
 const identity=await tx.manualSubscription.findFirst({where:{id,...ownedScope},select:{customerId:true}});
 if(!identity)throw new SubscriptionError('Subscription not found',404);
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${identity.customerId}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "ManualSubscription" WHERE id=${id}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid FOR SHARE`;
 const row=await tx.manualSubscription.findFirst({where:{id,...ownedScope},include:{customer:{select:{companyId:true,branchId:true}}}}),access=await loadSubscriptionAccess(tx,actorId,scope.tenantId);
 if(!row||!access.canRead(row)||!access.canReadCustomer(row.customer))throw new SubscriptionError('Subscription not found',404);
 const {customer,...current}=row;void customer;const subscription=subscriptionView(current);
 if(eventId){const event=await tx.manualSubscriptionRevision.findFirst({where:{id:eventId,subscriptionId:id,...ownedScope}});if(!event)throw new SubscriptionError('Revision not found',404);return {subscription,events:[subscriptionView(event)],page:0,nextPage:null,canManage:access.canManage(row)};}
 const events=await tx.manualSubscriptionRevision.findMany({where:{subscriptionId:id,...ownedScope},orderBy:{version:'desc'},skip:page*50,take:51});
 return {subscription,events:events.slice(0,50).map(subscriptionView),page,nextPage:events.length>50?page+1:null,canManage:access.canManage(row)};
 },transactionOptions);}
