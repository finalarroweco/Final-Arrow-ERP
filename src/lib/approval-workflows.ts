import {Prisma} from '@prisma/client';
import {db} from './db';
import {scopeMatches} from './scope';
import {approvalConfiguration,type ApprovalPolicyCommand,type ApprovalSubmit,type ApprovalVote,type ApprovalResource} from './approval-workflow-input';
export class ApprovalError extends Error{constructor(message:string,public status=409){super(message);}}
type Scope={tenantId:string;companyId:string;branchId:string|null};
type Command=ApprovalPolicyCommand|ApprovalSubmit|ApprovalVote;
type Row=Record<string,unknown>;
const options={timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
const keys:Record<ApprovalResource,[string,string]>={PURCHASE:['purchase-order:read','purchase-order:manage'],EXPENSE:['expense:read','expense:post'],LEAVE:['leave:read','leave:decide']};
function canonical(v:unknown):string{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v);}
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string,policy=false){if(policy)await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;else await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
async function access(tx:Prisma.TransactionClient,actorId:string,scope:Scope){
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId:scope.tenantId,userId:actorId}},select:{id:true,status:true}});
 const grants=member?.status==='ACTIVE'?await tx.roleGrant.findMany({where:{tenantId:scope.tenantId,membershipId:member.id},select:{role:{select:{name:true,permissions:{select:{permissionKey:true}}}},scopes:true}}):[];
 const has=(p:string)=>grants.some(g=>g.role.permissions.some(x=>x.permissionKey===p)&&g.scopes.some(s=>scopeMatches(s,{companyId:scope.companyId,branchId:scope.branchId??undefined})));
 const resources=(Object.keys(keys) as ApprovalResource[]).filter(r=>keys[r].every(has));
 const owner=grants.some(g=>g.role.name==='Owner'&&g.scopes.some(s=>s.type==='TENANT'));
 if(!resources.length&&!owner)throw new ApprovalError('Current source read and action access required',403);
 if(!await tx.company.findFirst({where:{tenantId:scope.tenantId,id:scope.companyId},select:{id:true}})||scope.branchId&&!await tx.branch.findFirst({where:{tenantId:scope.tenantId,companyId:scope.companyId,id:scope.branchId},select:{id:true}}))throw new ApprovalError('Scope not found',404);
 return {resources,owner};
}
async function source(tx:Prisma.TransactionClient,scope:Scope,resource:ApprovalResource,sourceId:string){
 const rows=await tx.$queryRaw<{snapshot:Row|null;fingerprint:string|null}[]>`SELECT s AS snapshot,md5(s::text) AS fingerprint FROM (SELECT erp_approval_snapshot(${scope.tenantId}::uuid,${resource},${sourceId}::uuid) AS s) q`;
 const row=rows[0];if(!row?.snapshot||row.snapshot.companyId!==scope.companyId||row.snapshot.branchId!==scope.branchId)throw new ApprovalError('Source not found in this exact scope',404);return row;
}
async function authorizeCommand(tx:Prisma.TransactionClient,actorId:string,input:Command,abandon=false){
 const a=await access(tx,actorId,input);
 if('configuration'in input){if(!a.owner)throw new ApprovalError('Organization owner access required',403);return;}
 let resource:ApprovalResource,sourceId:string;
 if('approvalId'in input){const rows=await tx.$queryRaw<Row[]>`SELECT * FROM "ApprovalRequest" WHERE id=${input.approvalId}::uuid AND "tenantId"=${input.tenantId}::uuid AND "companyId"=${input.companyId}::uuid AND "branchId" IS NOT DISTINCT FROM ${input.branchId}::uuid`;if(!rows[0])throw new ApprovalError('Approval not found',404);resource=rows[0].resource as ApprovalResource;sourceId=String(rows[0].sourceId);}
 else {resource=input.resource;sourceId=input.sourceId;}
 if(!a.resources.includes(resource))throw new ApprovalError('Current source read and action access required',403);
 if(!abandon)await source(tx,input,resource,sourceId);
}
export async function mutateApproval(actorId:string,input:Command,abandon=false){return db.$transaction(async tx=>{
 if(input.expectedActorId!==actorId)throw new ApprovalError('Saved request belongs to a different signed-in user',403);
 await tenantLock(tx,input.tenantId,'configuration'in input);
 await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${'approval-command:'+input.requestId},0))`;
 await authorizeCommand(tx,actorId,input,abandon);
 const saved=await tx.$queryRaw<Row[]>`SELECT * FROM "ApprovalCommand" WHERE id=${input.requestId}::uuid`;
 if(saved[0]){
  const row=saved[0];if(abandon&&row.outcome==='COMMITTED')await authorizeCommand(tx,actorId,input,false);if(row.actorId!==actorId||canonical(row.command)!==canonical(input))throw new ApprovalError('Request identity belongs to different details');
  if(!abandon&&row.outcome==='ABANDONED')throw new ApprovalError('Request was permanently abandoned; prepare a new request');
  return row.result;
 }
 const rows=await tx.$queryRaw<Row[]>`INSERT INTO "ApprovalCommand"(id,"tenantId","companyId","branchId","actorId",command,outcome) VALUES(${input.requestId}::uuid,${input.tenantId}::uuid,${input.companyId}::uuid,${input.branchId}::uuid,${actorId}::uuid,${JSON.stringify(input)}::jsonb,${abandon?'ABANDONED':'COMMITTED'}) RETURNING result`;
 return rows[0].result;
 },options);}
export async function previewApproval(actorId:string,scope:Scope,resource:ApprovalResource,sourceId:string){return db.$transaction(async tx=>{
 await tenantLock(tx,scope.tenantId);const a=await access(tx,actorId,scope);if(!a.resources.includes(resource))throw new ApprovalError('Current source read and action access required',403);
 const rows=await tx.$queryRaw<{snapshot:Row;fingerprint:string;policy:Row|null;approval:Row|null}[]>`SELECT s AS snapshot,md5(s::text) AS fingerprint,
 (SELECT to_jsonb(p) FROM "ApprovalPolicy" p WHERE p."tenantId"=${scope.tenantId}::uuid AND p."companyId"=${scope.companyId}::uuid AND (p."branchId" IS NULL OR p."branchId"=${scope.branchId}::uuid) AND erp_approval_matches(p.configuration,s,${resource}) ORDER BY p.id LIMIT 1) AS policy,
 (SELECT to_jsonb(r) FROM "ApprovalRequest" r WHERE r."tenantId"=${scope.tenantId}::uuid AND r.resource=${resource} AND r."sourceId"=${sourceId}::uuid ORDER BY r."createdAt" DESC,r.id DESC LIMIT 1) AS approval
 FROM (SELECT erp_approval_snapshot(${scope.tenantId}::uuid,${resource},${sourceId}::uuid) AS s) q WHERE (s->>'companyId')::uuid=${scope.companyId}::uuid AND (s->>'branchId')::uuid IS NOT DISTINCT FROM ${scope.branchId}::uuid`;
 const view=rows[0];if(!view)throw new ApprovalError('Source not found in this exact scope',404);
 return {actorId,...scope,resource,sourceId,source:view.snapshot,sourceFingerprint:view.fingerprint,policy:view.policy,approval:view.approval,observedAt:new Date().toISOString()};
 },options);}
export async function listApprovalRequests(actorId:string,scope:Scope,page:number){return db.$transaction(async tx=>{
 await tenantLock(tx,scope.tenantId);const a=await access(tx,actorId,scope);
 const rows=a.resources.length?await tx.$queryRaw<Row[]>(Prisma.sql`SELECT r.* FROM "ApprovalRequest" r WHERE "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid AND "branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid AND resource IN(${Prisma.join(a.resources)}) AND (erp_approval_snapshot(r."tenantId",r.resource,r."sourceId")->>'companyId')::uuid=r."companyId" AND (erp_approval_snapshot(r."tenantId",r.resource,r."sourceId")->>'branchId')::uuid IS NOT DISTINCT FROM r."branchId" ORDER BY "createdAt" DESC,id DESC OFFSET ${page*50} LIMIT 51`):[];
 return {actorId,...scope,items:rows.slice(0,50),page,nextPage:rows.length>50?page+1:null,canManagePolicies:a.owner};
 },options);}
export async function readApprovalRequest(actorId:string,scope:Scope,id:string,page:number){return db.$transaction(async tx=>{
 await tenantLock(tx,scope.tenantId);const a=await access(tx,actorId,scope);
 const rows=await tx.$queryRaw<Row[]>`SELECT * FROM "ApprovalRequest" WHERE id=${id}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid AND "branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid FOR SHARE`;
 const row=rows[0];if(!row||!a.resources.includes(row.resource as ApprovalResource))throw new ApprovalError('Authorized approval not found',404);
 const live=await source(tx,scope,row.resource as ApprovalResource,String(row.sourceId));
 const decisions=await tx.$queryRaw<Row[]>`SELECT * FROM "ApprovalDecision" WHERE "approvalId"=${id}::uuid ORDER BY "createdAt",id OFFSET ${page*50} LIMIT 51`;
 const config=approvalConfiguration.parse(row.policySnapshot);
 const eligibility=await tx.$queryRaw<{eligible:boolean}[]>`SELECT erp_approval_eligible(${actorId}::uuid,${scope.tenantId}::uuid,${scope.companyId}::uuid,${scope.branchId}::uuid,${JSON.stringify(config.stages[Number(row.stage)]??{})}::jsonb) AS eligible`;
 const policies=await tx.$queryRaw<Row[]>`SELECT version,configuration FROM "ApprovalPolicy" WHERE id=${String(row.policyId)}::uuid`;
 const currentPolicy=policies[0],currentConfiguration=currentPolicy?approvalConfiguration.parse(currentPolicy.configuration):null;
 const ready=await tx.$queryRaw<{ready:boolean}[]>`SELECT erp_approval_source_ready(${scope.tenantId}::uuid,${String(row.resource)},erp_approval_snapshot(${scope.tenantId}::uuid,${String(row.resource)},${String(row.sourceId)}::uuid)) AS ready`;
 const prior=await tx.$queryRaw<{ready:boolean}[]>`SELECT NOT EXISTS(SELECT 1 FROM "ApprovalDecision" d JOIN "ApprovalRequest" q ON q.id=d."approvalId" WHERE q.id=${id}::uuid AND d.action='APPROVE' AND (NOT erp_approval_access(d."actorId",q."tenantId",q."companyId",q."branchId",q.resource) OR NOT erp_approval_eligible(d."actorId",q."tenantId",q."companyId",q."branchId",q."policySnapshot"->'stages'->d.stage))) AS ready`;
 const blockedReason=row.status!=='PENDING'?'TERMINAL':!currentPolicy||currentPolicy.version!==row.policyVersion||!currentConfiguration?.enabled?'POLICY_CHANGED':live.fingerprint!==row.sourceFingerprint||!ready[0].ready?'SOURCE_CHANGED':config.excludeRequester&&(actorId===row.requesterId||actorId===live.snapshot?.createdBy)?'SELF_APPROVAL':!prior[0].ready?'PRIOR_APPROVER_CHANGED':!eligibility[0].eligible?'NOT_ELIGIBLE':null;
 return {actorId,...scope,approval:row,decisions:decisions.slice(0,50),page,nextPage:decisions.length>50?page+1:null,eligible:blockedReason===null,blockedReason,canCancel:row.status==='PENDING'&&(a.owner||row.requesterId===actorId)};
 },options);}
export async function listApprovalPolicies(actorId:string,scope:Scope,page:number,policyId?:string){return db.$transaction(async tx=>{
 await tenantLock(tx,scope.tenantId);const a=await access(tx,actorId,scope);if(!a.owner)throw new ApprovalError('Organization owner access required',403);
 const policies=await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "ApprovalPolicy" WHERE "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid AND "branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid ${policyId?Prisma.sql`AND id=${policyId}::uuid`:Prisma.empty} ORDER BY "updatedAt" DESC,id OFFSET ${policyId?0:page*50} LIMIT 51`);
 const revisions=policyId&&policies.length?await tx.$queryRaw<Row[]>`SELECT * FROM "ApprovalPolicyRevision" WHERE "policyId"=${policyId}::uuid ORDER BY version DESC OFFSET ${page*50} LIMIT 51`:[];
 const members=await tx.membership.findMany({where:{tenantId:scope.tenantId,status:'ACTIVE'},select:{user:{select:{id:true,name:true}}},orderBy:{userId:'asc'}});
 const roles=await tx.role.findMany({where:{tenantId:scope.tenantId},select:{id:true,name:true},orderBy:{name:'asc'}});
 return {actorId,...scope,policies:policies.slice(0,50),revisions:revisions.slice(0,50),page,nextPage:(policyId?revisions:policies).length>50?page+1:null,members:members.map(m=>m.user),roles};
 },options);}
/** Called inside every legacy source transition after source/tenant locks. */
export async function configuredApprovalRequired(tx:Prisma.TransactionClient,tenantId:string,resource:ApprovalResource,id:string){
 const rows=await tx.$queryRaw<{required:boolean}[]>`SELECT EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=${tenantId}::uuid AND resource=${resource} AND "sourceId"=${id}::uuid AND status='PENDING') OR EXISTS(SELECT 1 FROM "ApprovalPolicy" p, LATERAL (SELECT erp_approval_snapshot(${tenantId}::uuid,${resource},${id}::uuid) s) q WHERE p."tenantId"=${tenantId}::uuid AND p."companyId"=(s->>'companyId')::uuid AND (p."branchId" IS NULL OR p."branchId"=(s->>'branchId')::uuid) AND erp_approval_matches(p.configuration,s,${resource})) AS required`;
 return rows[0].required;
}
