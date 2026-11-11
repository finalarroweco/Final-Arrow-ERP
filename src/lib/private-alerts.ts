import {Prisma} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {canAccess} from './access';
import {alertQuery,alertList,canonicalAlertRequest,alertReceiptMatches,type AlertRequest} from './private-alert-input';
export class AlertError extends Error{constructor(message:string,public status=409){super(message);}}
const options={isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted,timeout:20000,maxWait:10000};
export const alertPermission=(kind:string)=>kind==='TICKET_DEADLINE'?'ticket:read':kind==='SUBSCRIPTION_REVIEW'?'subscription:read':'inventory-stock:read';
async function lock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
async function member(tx:Prisma.TransactionClient,actorId:string,tenantId:string){const m=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{status:true}});if(m?.status!=='ACTIVE')throw new AlertError('Current membership required',403);}
async function authorize(tx:Prisma.TransactionClient,actorId:string,p:AlertRequest,recovery=false){
 if(actorId!==p.expectedActorId)throw new AlertError('Signed-in user changed. Reload before continuing.',403);
 await member(tx,actorId,p.tenantId);
 if(p.action==='create'){
  if(!p.config||!recovery&&!await canAccess({userId:actorId,tenantId:p.tenantId,companyId:p.companyId,branchId:p.config.branchId??undefined,permission:alertPermission(p.config.kind)},tx))throw new AlertError('Current source scope access required',403);
 }else{
  const rows=await tx.$queryRaw<{allowed:boolean}[]>`SELECT (${recovery} OR erp_alert_rule_access(r)) AND (${recovery} OR ${p.noticeId}::uuid IS NULL OR EXISTS(SELECT 1 FROM "PrivateAlertNotice" n WHERE n.id=${p.noticeId}::uuid AND n."ruleId"=r.id AND erp_alert_source_visible(r,n."sourceId"))) AS allowed FROM "PrivateAlertRule" r WHERE r.id=${p.ruleId}::uuid AND r."tenantId"=${p.tenantId}::uuid AND r."companyId"=${p.companyId}::uuid AND r."actorId"=${actorId}::uuid`;
  if(!rows[0]?.allowed)throw new AlertError('Current private rule and source access required',403);
 }
}
export async function mutateAlert(actorId:string,p:AlertRequest,abandon=false){return db.$transaction(async tx=>{
 await lock(tx,p.tenantId);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'private-alert-request:'+p.requestId},0))`;
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'private-alert-rule:'+p.ruleId},0))`;
 await authorize(tx,actorId,p,abandon);
 const saved=await tx.$queryRaw<{request:AlertRequest;outcome:string;result:unknown;actorId:string}[]>`SELECT request,outcome,result,"actorId" FROM "PrivateAlertRequest" WHERE id=${p.requestId}::uuid`;
 if(saved.length){const row=saved[0];if(row.actorId!==actorId||JSON.stringify(canonicalAlertRequest(p))!==JSON.stringify(canonicalAlertRequest(row.request)))throw new AlertError('Request identity belongs to different details');if(row.outcome==='ABANDONED'&&!abandon)throw new AlertError('Request was abandoned. Prepare a new request.');const receipt=row.result??{requestId:p.requestId,ruleId:p.ruleId,actorId,action:p.action,version:p.expectedVersion+1,outcome:'ABANDONED',request:canonicalAlertRequest(p)};if(!alertReceiptMatches(p,receipt))throw new AlertError('Unverified saved receipt');return {receipt};}
 const rows=await tx.$queryRaw<{result:unknown}[]>`INSERT INTO "PrivateAlertRequest"(id,"tenantId","companyId","actorId","ruleId",action,"expectedVersion",request,outcome) VALUES(${p.requestId}::uuid,${p.tenantId}::uuid,${p.companyId}::uuid,${actorId}::uuid,${p.ruleId}::uuid,${p.action},${p.expectedVersion},${JSON.stringify(canonicalAlertRequest(p))}::jsonb,${abandon?'ABANDONED':'COMMITTED'}) RETURNING result`;
 const receipt=rows[0].result??{requestId:p.requestId,ruleId:p.ruleId,actorId,action:p.action,version:p.expectedVersion+1,outcome:'ABANDONED',request:canonicalAlertRequest(p)};if(!alertReceiptMatches(p,receipt))throw new AlertError('Unverified alert receipt');return {receipt};
 },options);}
export async function listAlerts(actorId:string,p:z.infer<typeof alertQuery>){return db.$transaction(async tx=>{
 await lock(tx,p.tenantId);await member(tx,actorId,p.tenantId);
 if(p.expectedActorId!==actorId)throw new AlertError('Signed-in user changed. Reload before reading.',403);
 // Current permissions filter BEFORE pagination, so neither totals nor nextPage reveal hidden sources.
 const rules=p.view==='rules'?await tx.$queryRaw<{row:unknown}[]>`SELECT to_jsonb(r) AS row FROM "PrivateAlertRule" r WHERE r."actorId"=${actorId}::uuid AND r."tenantId"=${p.tenantId}::uuid AND r."companyId"=${p.companyId}::uuid AND erp_alert_rule_access(r) ORDER BY r."createdAt" DESC,r.id LIMIT 51 OFFSET ${p.page*50}`:[];
 const notices=p.view==='notices'?await tx.$queryRaw<{row:unknown}[]>`SELECT to_jsonb(n)||jsonb_build_object('kind',r.kind,'branchId',r."branchId") AS row FROM "PrivateAlertNotice" n JOIN "PrivateAlertRule" r ON r.id=n."ruleId" WHERE r."actorId"=${actorId}::uuid AND r."tenantId"=${p.tenantId}::uuid AND r."companyId"=${p.companyId}::uuid AND (${p.ruleId??null}::uuid IS NULL OR r.id=${p.ruleId??null}::uuid) AND (${p.unread}='0' OR n."acknowledgedAt" IS NULL) AND erp_alert_source_visible(r,n."sourceId") ORDER BY n."observedAt" DESC,n.id LIMIT 51 OFFSET ${p.page*50}`:[];
 return alertList.parse({actorId,tenantId:p.tenantId,companyId:p.companyId,view:p.view,ruleId:p.ruleId??null,page:p.page,nextPage:Math.max(rules.length,notices.length)>50?p.page+1:null,rules:rules.slice(0,50).map(x=>x.row),notices:notices.slice(0,50).map(x=>x.row)});
 },options);}
