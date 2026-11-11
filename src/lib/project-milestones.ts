import {invoiceSessionAllowed} from './invoice-session';
import {Prisma} from '@prisma/client';
import {db} from './db';
import {BillingError} from './recurring-billing';
import {loadMilestoneAccess} from './project-milestone-access';
import {canonicalMilestoneAction,milestoneFilters,type MilestoneAction} from './project-milestone-input';
import type {z} from 'zod';
export const milestoneTransactionOptions={timeout:30000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
export const milestoneJson=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const milestoneDate=(value:Date)=>value.toISOString().slice(0,10);
export async function requireMilestoneSession(tx:Prisma.TransactionClient,actorId:string){
 if(!await invoiceSessionAllowed(tx,actorId))throw new BillingError('Session expired or revoked',401);
}
export async function lockMilestone(tx:Prisma.TransactionClient,p:{tenantId:string;companyId:string;projectId:string;requestId?:string;milestoneId?:string;customerId?:string;branchId?:string|null;replacesSourceId?:string|null}){
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "Company" WHERE "tenantId"=${p.tenantId}::uuid AND id=${p.companyId}::uuid FOR UPDATE`;
 // Transitions omit customerId. Resolve only the immutable exact-scope source
 // before Customer -> Project locks; never wait in the deferred action guard
 // after the final browser-session and current-grant validation.
 const source=!p.customerId&&p.milestoneId?await tx.projectMilestone.findFirst({where:{id:p.milestoneId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,branchId:p.branchId??null},select:{customerId:true}}):null;
 const customerId=p.customerId??source?.customerId;
 if(customerId)await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${customerId}::uuid AND "tenantId"=${p.tenantId}::uuid AND "companyId"=${p.companyId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${p.projectId}::uuid FOR UPDATE`;
 // Correction guards lock the prior invoice at commit. Acquire it before final
 // session/scope checks so that validation cannot precede a late source wait.
 if(p.replacesSourceId&&p.customerId)await tx.$queryRaw`SELECT i.id FROM "Invoice" i JOIN "ProjectMilestoneInvoiceSource" s ON s.id=i."projectMilestoneSourceId" WHERE s.id=${p.replacesSourceId}::uuid AND s."tenantId"=${p.tenantId}::uuid AND s."companyId"=${p.companyId}::uuid AND s."projectId"=${p.projectId}::uuid AND s."customerId"=${p.customerId}::uuid AND s."branchId" IS NOT DISTINCT FROM ${p.branchId??null}::uuid FOR UPDATE OF i`;
 if(p.requestId)await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'project-milestone:'+p.requestId},0))`;
}
export async function milestoneContext(tx:Prisma.TransactionClient,actorId:string,p:{tenantId:string;companyId:string;projectId:string;branchId:string|null;expectedActorId:string},permissions:string[]=[]){
 await requireMilestoneSession(tx,actorId);
 if(actorId!==p.expectedActorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadMilestoneAccess(tx,actorId,p.tenantId);
 for(const permission of ['project:read','project-milestone:read',...permissions])if(!access.can(permission,p))throw new BillingError('Current milestone access required',403);
 const project=await tx.project.findFirst({where:{id:p.projectId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId}});
 if(!project)throw new BillingError('Project unavailable',404);
 return {project,access};
}
export async function mutateMilestone(actorId:string,input:MilestoneAction,abandon=false){const p=canonicalMilestoneAction(input);return db.$transaction(async tx=>{
 await lockMilestone(tx,p);
 const {project,access}=await milestoneContext(tx,actorId,p,[p.kind==='APPROVE'?'project-milestone:approve':'project-milestone:manage']);
 const saved=await tx.projectMilestoneAction.findUnique({where:{id:p.requestId}});
 const receipt=(row:NonNullable<typeof saved>)=>{if(row.createdBy!==actorId||JSON.stringify(canonicalMilestoneAction(row.request))!==JSON.stringify(p))throw new BillingError('Request identity belongs to different details');return {actorId,requestId:row.id,request:row.request,result:row.result,outcome:row.outcome};};
 const milestone=p.kind==='CREATE'?null:await tx.projectMilestone.findFirst({where:{id:p.milestoneId,tenantId:p.tenantId,companyId:p.companyId,projectId:p.projectId,branchId:p.branchId}});
 const customerId=p.kind==='CREATE'?p.customerId:milestone?.customerId;
 const customer=customerId?await tx.customer.findFirst({where:{id:customerId,tenantId:p.tenantId,companyId:p.companyId}}):null;
 if(!customer||!access.can('customer:read',customer)||customer.branchId!==null&&customer.branchId!==p.branchId)throw new BillingError('Current customer access required',403);
 if(saved){if(!abandon&&saved.outcome==='ABANDONED')throw new BillingError('Request permanently abandoned');return receipt(saved);}
 let result:Prisma.InputJsonValue={kind:'abandoned'};
 if(!abandon){
  if(!['PLANNED','ACTIVE','ON_HOLD'].includes(project.status)||customer.archivedAt)throw new BillingError('Project or customer unavailable for milestone changes');
  if(p.kind==='CREATE'){
   const row=await tx.projectMilestone.create({data:{id:p.milestoneId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,customerId:p.customerId,description:p.description,currency:p.currency,agreedPrice:p.agreedPrice,treatment:p.treatment,paymentTerms:p.paymentTerms,paymentDueDate:p.paymentDueDate?new Date(p.paymentDueDate):null,requestId:p.requestId,createdBy:actorId}});
   result={kind:'milestone',milestoneId:row.id,status:row.status,sequence:row.sequence};
  }else{
   if(!milestone||milestone.sequence!==p.expectedSequence)throw new BillingError('Milestone changed; refresh before reviewing');
   const expected=p.kind==='COMPLETE'?'DRAFT':p.kind==='APPROVE'?'COMPLETED':null;
   if(milestone.status==='CANCELLED'||expected&&milestone.status!==expected)throw new BillingError('Invalid milestone transition');
   if(p.kind==='CANCEL'&&await tx.projectMilestoneInvoiceClaim.count({where:{milestoneId:milestone.id}}))throw new BillingError('Claimed milestone cannot be cancelled; use invoice correction');
   const status=p.kind==='COMPLETE'?'COMPLETED':p.kind==='APPROVE'?'APPROVED':'CANCELLED';
   await tx.projectMilestone.update({where:{id:milestone.id},data:{status,sequence:{increment:1}}});
   result={kind:'milestone',milestoneId:milestone.id,status,sequence:milestone.sequence+1};
  }
 }
 return receipt(await tx.projectMilestoneAction.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,projectId:p.projectId,milestoneId:p.milestoneId,request:milestoneJson(p),result,outcome:abandon?'ABANDONED':'COMMITTED',createdBy:actorId}}));
 },milestoneTransactionOptions);}
export async function listMilestones(actorId:string,p:z.infer<typeof milestoneFilters>){return db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
 await requireMilestoneSession(tx,actorId);if(actorId!==p.expectedActorId)throw new BillingError('Signed-in user changed',403);
 const access=await loadMilestoneAccess(tx,actorId,p.tenantId);
 const a=access.branches('project:read',p.companyId),b=access.branches('project-milestone:read',p.companyId),branches=a===null?b:b===null?a:a.filter(id=>b.includes(id));
 if(branches?.length===0)throw new BillingError('Milestone read required',403);
 const scope={tenantId:p.tenantId,companyId:p.companyId,...(branches===null?{}:{branchId:{in:branches}})};
 const projects=await tx.project.findMany({where:scope,select:{id:true,code:true,name:true,branchId:true,status:true},orderBy:{id:'asc'},skip:p.page*50,take:51});
 if(p.projectId&&!await tx.project.findFirst({where:{...scope,id:p.projectId}}))throw new BillingError('Project unavailable',403);
 const cb=access.branches('customer:read',p.companyId);
 const customers=await tx.customer.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,...(cb===null?{}:{branchId:{in:cb}})},select:{id:true,displayName:true,branchId:true,archivedAt:true},orderBy:{id:'asc'},skip:p.page*50,take:51});
 // Foreign keys preserve customer identity; current grants determine visibility.
 const customerIds=cb===null?null:(await tx.customer.findMany({where:{tenantId:p.tenantId,companyId:p.companyId,branchId:{in:cb}},select:{id:true}})).map(c=>c.id);
 const milestones=p.projectId?await tx.projectMilestone.findMany({where:{...scope,projectId:p.projectId,...(customerIds===null?{}:{customerId:{in:customerIds}})},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:p.page*50,take:51}):[];
 const claims=await tx.projectMilestoneInvoiceClaim.findMany({where:{milestoneId:{in:milestones.map(m=>m.id)}},select:{milestoneId:true}});
 const sources=p.projectId?await tx.projectMilestoneInvoiceSource.findMany({where:{...scope,projectId:p.projectId,...(customerIds===null?{}:{customerId:{in:customerIds}})},include:{invoice:{select:{id:true,number:true,status:true}}},orderBy:[{createdAt:'desc'},{id:'asc'}],skip:p.page*50,take:51}):[];
 return {actorId,projects:projects.slice(0,50),customers:customers.slice(0,50),milestones:milestones.slice(0,50).map(m=>({...m,agreedPrice:m.agreedPrice.toFixed(3),claimed:claims.some(c=>c.milestoneId===m.id)})),sources:sources.slice(0,50).map(s=>({...s,agreedPrice:s.agreedPrice.toFixed(3),subtotal:s.subtotal.toFixed(3),taxAmount:s.taxAmount.toFixed(3),invoice:access.can('invoice:read',s)?s.invoice:null})),page:p.page,nextPage:[projects,customers,milestones,sources].some(a=>a.length>50)?p.page+1:null};
 },milestoneTransactionOptions);}
