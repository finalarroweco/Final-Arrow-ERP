import {randomUUID,timingSafeEqual} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {automationPreview,automationQuery,type AutomationCommand,type AutomationConfig} from './automation-input';
import {mutateRecurringBillingTx,periodPreview} from './recurring-billing';
import {recurringGenerateRequest} from './recurring-input';
import {mutateAlertTx} from './private-alerts';
import {alertRequest} from './private-alert-input';
export class AutomationError extends Error{constructor(message:string,public status=409){super(message);}}
export type AutomationJob={id:string;tenantId:string;companyId:string;branchId:string|null;actorId:string;kind:'RECURRING_DRAFT'|'PRIVATE_ALERT';sourceId:string;config:AutomationConfig;authorizedFingerprint:string;state:string;version:number;nextDueAt:Date;runsUsed:number;cursor:number|null;lastCode:string;createdAt:Date};
type Run={id:string;jobId:string;sequence:number;state:string;downstreamId:string;payload:unknown;attempts:number;fence:number;leaseToken:string|null;leaseUntil:Date|null;scheduledAt:Date;nextAttemptAt:Date;code:string;createdAt:Date;finishedAt:Date|null};
export type Lease={claimed:true;jobId:string;runId:string;token:string;fence:number};
const options={isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:30000,maxWait:10000};
export function automationRunnerStatus(){return {enabled:process.env.ERP_AUTOMATION_RUNNER_ENABLED==='true',configured:!!process.env.ERP_AUTOMATION_RUNNER_TOKEN&&process.env.ERP_AUTOMATION_RUNNER_TOKEN.length>=32};}
export function authorizeAutomationRunner(authorization:string|null){const status=automationRunnerStatus();if(!status.enabled||!status.configured)return false;const expected=Buffer.from('Bearer '+process.env.ERP_AUTOMATION_RUNNER_TOKEN),actual=Buffer.from(authorization??'');return expected.length===actual.length&&timingSafeEqual(expected,actual);}
async function event(tx:Prisma.TransactionClient,jobId:string,actorId:string,operation:string,data:unknown,id:string=randomUUID()){
 const rows=await tx.$queryRaw<{result:unknown}[]>`INSERT INTO "AutomationEvent"(id,"jobId","actorId",operation,data) VALUES(${id}::uuid,${jobId}::uuid,${actorId}::uuid,${operation},${JSON.stringify(data)}::jsonb) RETURNING result`;
 return rows[0].result;
}
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
async function activeMember(tx:Prisma.TransactionClient,actorId:string,tenantId:string){if((await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{status:true}}))?.status!=='ACTIVE')throw new AutomationError('Current membership required',403);}
async function currentSession(tx:Prisma.TransactionClient,actorId:string,sessionId?:string){
 if(!sessionId)return; // Trusted internal/service callers; HTTP routes always pass the current session ID.
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Session" WHERE id=${sessionId}::uuid AND "userId"=${actorId}::uuid AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') FOR SHARE`;
 if(!rows.length)throw new AutomationError('Session expired. Sign in again.',401);
}
export async function automationSourcePreview(actorId:string,p:z.infer<typeof automationPreview>,sessionId?:string){return db.$transaction(async tx=>{
 if(actorId!==p.expectedActorId)throw new AutomationError('Signed-in user changed',403);await tenantLock(tx,p.tenantId);await activeMember(tx,actorId,p.tenantId);await currentSession(tx,actorId,sessionId);
 const rows=await tx.$queryRaw<{allowed:boolean;fingerprint:string|null;authorization:unknown}[]>`SELECT erp_automation_access(j) AS allowed,erp_automation_fingerprint(j) AS fingerprint,
 CASE j.kind WHEN 'RECURRING_DRAFT' THEN (SELECT jsonb_build_object('effectivePeriod',r."effectivePeriod",'subscriptionVersion',s.version,'subscriptionRevisionId',r.id,'planRevisionId',pr.id,'planVersion',pr.version,'currency',s.currency,'planLabel',pr.label,'lines',pr.lines,'terms',r.terms,'anchor',s.anchor::text,'cadence',s.cadence,'horizon',r.horizon::text,'vatProfile',to_jsonb(v)) FROM "BillingSubscription" s JOIN "BillingSubscriptionRevision" r ON r."subscriptionId"=s.id AND r.version=s.version JOIN "BillingPlanRevision" pr ON pr.id=r."planRevisionId" LEFT JOIN "CompanyVatProfile" v ON v."companyId"=s."companyId" WHERE s.id=j."sourceId")
 ELSE (SELECT jsonb_build_object('ruleVersion',r.version,'kind',r.kind,'branchId',r."branchId",'lookbackDays',r."lookbackDays",'horizonDays',r."horizonDays",'priority',r.priority) FROM "PrivateAlertRule" r WHERE r.id=j."sourceId") END AS authorization
 FROM jsonb_populate_record(NULL::"AutomationJob",${JSON.stringify({...p,actorId})}::jsonb) j`;
 if(!rows[0]?.allowed)throw new AutomationError('Current source scope and automation permission required',403);if(!rows[0].fingerprint)throw new AutomationError('Source must be enabled and configured');
 return {actorId,sourceId:p.sourceId,kind:p.kind,sourceFingerprint:rows[0].fingerprint,authorization:rows[0].authorization};
 },options);}
export async function mutateAutomation(actorId:string,p:AutomationCommand,abandon=false,sessionId?:string){return db.$transaction(async tx=>{
 if(actorId!==p.expectedActorId)throw new AutomationError('Signed-in user changed',403);await tenantLock(tx,p.tenantId);await activeMember(tx,actorId,p.tenantId);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'automation-command:'+p.requestId},0))`;
 const rows=await tx.$queryRaw<{actorId:string;data:{request:AutomationCommand;outcome:string};result:unknown}[]>`SELECT "actorId",data,result FROM "AutomationEvent" WHERE id=${p.requestId}::uuid`;
 if(rows[0]){
  await currentSession(tx,actorId,sessionId);
  const old=rows[0];if(old.actorId!==actorId||JSON.stringify(old.data.request)!==JSON.stringify(JSON.parse(JSON.stringify(p)))){
   // JSONB key order is not JavaScript insertion order: compare canonically in SQL.
   const same=await tx.$queryRaw<{same:boolean}[]>`SELECT data->'request'=${JSON.stringify(p)}::jsonb AS same FROM "AutomationEvent" WHERE id=${p.requestId}::uuid AND "actorId"=${actorId}::uuid`;
   if(!same[0]?.same)throw new AutomationError('Request identity belongs to different details');
  }
  if(old.data.outcome==='ABANDONED'&&!abandon)throw new AutomationError('Command permanently abandoned');return {receipt:old.result};
 }
 if(p.action==='create')await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'automation-job:'+p.jobId},0))`;
 else await tx.$queryRaw`SELECT id FROM "AutomationJob" WHERE id=${p.jobId}::uuid FOR UPDATE`;
 await currentSession(tx,actorId,sessionId);
 const receipt=await event(tx,p.jobId,actorId,'COMMAND',{request:p,outcome:abandon?'ABANDONED':'COMMITTED'},p.requestId);await currentSession(tx,actorId,sessionId);return {receipt};
 },options);}
export async function listAutomation(actorId:string,p:z.infer<typeof automationQuery>,sessionId?:string){return db.$transaction(async tx=>{
 if(actorId!==p.expectedActorId)throw new AutomationError('Signed-in user changed',403);await tenantLock(tx,p.tenantId);await activeMember(tx,actorId,p.tenantId);await currentSession(tx,actorId,sessionId);
 // Current source rights filter BEFORE pagination. Retained history is metadata only.
 const rows=await tx.$queryRaw<AutomationJob[]>`SELECT j.* FROM "AutomationJob" j WHERE j."actorId"=${actorId}::uuid AND j."tenantId"=${p.tenantId}::uuid AND j."companyId"=${p.companyId}::uuid AND j."branchId" IS NOT DISTINCT FROM ${p.branchId}::uuid AND (${p.jobId??null}::uuid IS NULL OR j.id=${p.jobId??null}::uuid) AND erp_automation_access(j) ORDER BY j."createdAt" DESC,j.id LIMIT 51 OFFSET ${p.jobId?0:p.page*50}`;
 let runs:unknown[]=[];let nextPage=rows.length>50?p.page+1:null;
 if(p.jobId&&rows.length){const found=await tx.$queryRaw<Array<Omit<Run,'payload'|'downstreamId'|'leaseToken'|'fence'>>>`SELECT id,"jobId",sequence,state,attempts,"scheduledAt","leaseUntil","nextAttemptAt",code,"createdAt","finishedAt" FROM "AutomationRun" WHERE "jobId"=${p.jobId}::uuid ORDER BY sequence DESC LIMIT 51 OFFSET ${p.page*50}`;runs=found.slice(0,50);nextPage=found.length>50?p.page+1:null;}
 return {actorId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.branchId,page:p.page,nextPage,jobs:rows.slice(0,50).map(j=>({id:j.id,kind:j.kind,sourceId:j.sourceId,state:j.state,version:j.version,config:j.config,nextDueAt:j.nextDueAt,runsUsed:j.runsUsed,cursor:j.cursor,lastCode:j.lastCode,createdAt:j.createdAt})),runs,runner:automationRunnerStatus()};
 },options);}
async function lockJob(tx:Prisma.TransactionClient,jobId:string){const identities=await tx.$queryRaw<{tenantId:string}[]>`SELECT "tenantId" FROM "AutomationJob" WHERE id=${jobId}::uuid`;if(!identities[0])throw new AutomationError('Job not found',404);await tenantLock(tx,identities[0].tenantId);const rows=await tx.$queryRaw<AutomationJob[]>`SELECT * FROM "AutomationJob" WHERE id=${jobId}::uuid FOR UPDATE`;return rows[0];}
async function assertLease(tx:Prisma.TransactionClient,j:AutomationJob,l:Lease){const rows=await tx.$queryRaw<Run[]>`SELECT * FROM "AutomationRun" WHERE id=${l.runId}::uuid AND "jobId"=${j.id}::uuid AND state='LEASED' AND "leaseToken"=${l.token}::uuid AND fence=${l.fence} AND "leaseUntil">clock_timestamp() FOR UPDATE`;if(j.state!=='ENABLED'||!rows[0])throw new AutomationError('Expired or superseded lease');return rows[0];}
async function currentSource(tx:Prisma.TransactionClient,j:AutomationJob,r:Run){
 // Lock the same commercial/configuration boundaries as the source service.
 if(j.kind==='RECURRING_DRAFT')await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${j.companyId}::uuid AND "tenantId"=${j.tenantId}::uuid FOR UPDATE`;
 else {await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'private-alert-request:'+r.downstreamId},0))`;await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'private-alert-rule:'+j.sourceId},0))`;}
 const rows=await tx.$queryRaw<{allowed:boolean;fingerprint:string|null}[]>`SELECT erp_automation_access(j) AS allowed,erp_automation_fingerprint(j) AS fingerprint FROM "AutomationJob" j WHERE id=${j.id}::uuid`;
 if(!rows[0]?.allowed||rows[0].fingerprint!==j.authorizedFingerprint)throw new AutomationError('Source authorization or configuration changed',403);
}
export async function claimAutomationJobs(limit=5):Promise<Lease[]>{
 if(!Number.isInteger(limit)||limit<1||limit>10)throw new AutomationError('Bounded claim limit required',400);
 // Round-robin candidate ranks per tenant/actor, oldest due within each rank.
 // One pending run per job prevents a noisy resource monopolizing a batch.
 const candidates=await db.$queryRaw<{id:string;tenantId:string}[]>`WITH due AS (
 SELECT j.id,j."tenantId",j."actorId",COALESCE(r."leaseUntil",r."nextAttemptAt",j."nextDueAt") AS due_at FROM "AutomationJob" j LEFT JOIN "AutomationRun" r ON r."jobId"=j.id AND r.state IN('READY','LEASED','RETRY') WHERE j.state='ENABLED' AND ((r.id IS NULL AND j."nextDueAt"<=clock_timestamp()) OR (r.id IS NOT NULL AND r."nextAttemptAt"<=clock_timestamp() AND (r.state<>'LEASED' OR r."leaseUntil"<=clock_timestamp())))
 ), fair AS (SELECT *,row_number() OVER(PARTITION BY "tenantId","actorId" ORDER BY due_at,id) AS turn FROM due)
 SELECT id,"tenantId" FROM fair ORDER BY turn,due_at,id LIMIT ${limit*4}`;
 const leases:Lease[]=[];
 for(const candidate of candidates){if(leases.length>=limit)break;const result=await db.$transaction(async tx=>{
  await tenantLock(tx,candidate.tenantId);
  const locked=await tx.$queryRaw<AutomationJob[]>`SELECT * FROM "AutomationJob" WHERE id=${candidate.id}::uuid FOR UPDATE SKIP LOCKED`;if(!locked[0])return null;
  return event(tx,candidate.id,locked[0].actorId,'CLAIM',{runId:randomUUID(),downstreamId:randomUUID(),token:randomUUID()});
 },options) as Lease|null;if(result?.claimed)leases.push(result);}
 return leases;
}
export async function prepareAutomationRun(l:Lease){return db.$transaction(async tx=>{
 const j=await lockJob(tx,l.jobId),r=await assertLease(tx,j,l);await currentSource(tx,j,r);if(r.payload)return {prepared:true};
 let payload:unknown;
 if(j.kind==='RECURRING_DRAFT'){
  const preview=await periodPreview(tx,j.actorId,{tenantId:j.tenantId,companyId:j.companyId,branchId:j.branchId,expectedActorId:j.actorId,subscriptionId:j.sourceId,offset:j.cursor!,limit:1,backfill:false,replacesSourceId:null,replacementPlanRevisionId:null},j.cursor!);
  if(preview.outcome!=='READY'){await event(tx,j.id,j.actorId,'FINISH',{...l,code:preview.outcome});return {prepared:false};}
  payload=recurringGenerateRequest.parse({tenantId:j.tenantId,companyId:j.companyId,branchId:j.branchId,expectedActorId:j.actorId,requestId:r.downstreamId,reason:'Explicit automation draft job '+j.id,action:'generate',subscriptionId:j.sourceId,expectedVersion:preview.subscriptionVersion,periodIndex:j.cursor,previewHash:preview.previewHash,replacesSourceId:null,replacementPlanRevisionId:null});
 }else{
  const rules=await tx.$queryRaw<{version:number}[]>`SELECT version FROM "PrivateAlertRule" WHERE id=${j.sourceId}::uuid`;
  payload=alertRequest.parse({tenantId:j.tenantId,companyId:j.companyId,expectedActorId:j.actorId,requestId:r.downstreamId,ruleId:j.sourceId,expectedVersion:rules[0].version,action:'evaluate',config:null,noticeId:null});
 }
 await event(tx,j.id,j.actorId,'PREPARE',{...l,payload});return {prepared:true};
 },options);}
export async function executeAutomationRun(l:Lease){return db.$transaction(async tx=>{
 const j=await lockJob(tx,l.jobId),r=await assertLease(tx,j,l);await currentSource(tx,j,r);if(!r.payload)throw new AutomationError('Persisted downstream request required');
 let code='COMMITTED';
 if(j.kind==='RECURRING_DRAFT'){
  const request=recurringGenerateRequest.parse(r.payload);
  const existing=await tx.serviceInvoiceSource.findFirst({where:{subscriptionId:j.sourceId,periodIndex:request.periodIndex,correctionIndex:0},select:{id:true}});
  if(existing){
   // Another authorized job/manual command already created this period. Permanently
   // fence this saved UUID; do not replace VOID or recompute its original request.
   const receipt=await mutateRecurringBillingTx(tx,j.actorId,request,true);
   code=receipt.outcome==='COMMITTED'?'COMMITTED':'GENERATED';
  }else await mutateRecurringBillingTx(tx,j.actorId,request);
 }else await mutateAlertTx(tx,j.actorId,alertRequest.parse(r.payload));
 // The source effect and fenced completion commit together. A lost HTTP/DB response
 // is recovered by reading this durable state, never by generating a fresh UUID.
 await event(tx,j.id,j.actorId,'FINISH',{...l,code});
 return {completed:true};
 },options);}
export async function recordAutomationError(l:Lease){return db.$transaction(async tx=>{const j=await lockJob(tx,l.jobId);await assertLease(tx,j,l);await event(tx,j.id,j.actorId,'ERROR',l);},options);}
export async function runAutomationBatch(){
 const state=automationRunnerStatus();if(!state.enabled||!state.configured)throw new AutomationError('Automation runner is disabled or unconfigured',503);
 let claimed=0;let completed=0;let pending=0;
 // Claim just before processing, so later work does not burn its lease waiting
 // behind earlier transactions. Concurrent runner invocations remain fenced.
 for(let i=0;i<5;i++){
  const [lease]=await claimAutomationJobs(1);if(!lease)break;claimed++;
  try{if((await prepareAutomationRun(lease)).prepared)await executeAutomationRun(lease);completed++;}catch{pending++;try{await recordAutomationError(lease);}catch{/* Unknown response or stale lease: the next bounded claim recovers persisted state. */}}
 }
 return {claimed,completed,pending};
}
