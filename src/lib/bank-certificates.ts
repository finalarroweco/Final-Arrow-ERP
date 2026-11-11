import { apiJson } from "@/lib/api-response";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { scopeMatches } from "./scope";
import { lockBankAccount } from "./bank-reconciliation";
import { certificateSnapshot, certificateHash, CertificateError, type BankCertificateInputs } from "./bank-certificate-snapshot";
import type { CertificateCreateInput, CertificateEventInput } from "./bank-certificate-input";
export { CertificateError } from "./bank-certificate-snapshot";
async function allowed(tx:Prisma.TransactionClient,actorId:string,tenantId:string,companyId:string,action?:"create"|"manage") {
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 if(member?.status!=="ACTIVE")return false;
 const permissions=["ledger:read",...(action?[`bank-reconciliation:${action}`]:[])];
 const grants=await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:permissions}},select:{permissionKey:true}}}}}});
 return permissions.every(permission=>grants.some(g=>g.role.permissions.some(p=>p.permissionKey===permission)&&g.scopes.some(s=>scopeMatches(s,{companyId}))));
}
export async function certificateAllowed(actorId:string,tenantId:string,companyId:string,action?:"create"|"manage") {return allowed(db,actorId,tenantId,companyId,action);}
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
async function requireAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string,companyId:string,action?:"create"|"manage") {
 if(!(await allowed(tx,actorId,tenantId,companyId,action)))throw new CertificateError("Company-wide ledger read and the requested snapshot permission are required",403);
}
async function statementAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string,id:string,action?:"create") {
 const row=await tx.bankStatement.findFirst({where:{id,tenantId},select:{companyId:true,accountId:true}});
 if(!row)throw new CertificateError("Statement not found",404);await requireAccess(tx,actorId,tenantId,row.companyId,action);return row;
}
async function capture(tx:Prisma.TransactionClient,tenantId:string,id:string) {
 // STABLE SQL function reads every source using this one statement's MVCC snapshot.
 const [row]=await tx.$queryRaw<{inputs:BankCertificateInputs|null;observedAt:Date}[]>`SELECT erp_bank_reconciliation_inputs(${id}::uuid,${tenantId}::uuid) AS inputs,date_trunc('milliseconds',statement_timestamp()) AS "observedAt"`;
 if(!row?.inputs)throw new CertificateError("Statement not found",404);
 const snapshot=certificateSnapshot(row.inputs);return {snapshot,digest:certificateHash(snapshot),observedAt:row.observedAt};
}
const options={timeout:30000,maxWait:10000};
export async function previewCertificate(actorId:string,tenantId:string,id:string) {
 return db.$transaction(async tx=>{await tenantLock(tx,tenantId);const s=await statementAccess(tx,actorId,tenantId,id);await lockBankAccount(tx,tenantId,s.companyId,s.accountId);return capture(tx,tenantId,id);},options);
}
async function audit(tx:Prisma.TransactionClient,tenantId:string,actorId:string,id:string,entity:string,action:string,extra:Record<string,string|number>) {
 const [clock]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
 await tx.auditLog.create({data:{tenantId,actorId,entity,entityId:id,action,metadata:{...extra,transaction:clock.transaction}}});
}
export async function createCertificate(actorId:string,id:string,input:CertificateCreateInput) {
 return db.$transaction(async tx=>{
  await tenantLock(tx,input.tenantId);const s=await statementAccess(tx,actorId,input.tenantId,id,"create");await lockBankAccount(tx,input.tenantId,s.companyId,s.accountId);
  const requestDigest=certificateHash({actorId,id,...input}),prior=await tx.bankReconciliationCertificate.findUnique({where:{id:input.requestId}});
  if(prior){if(prior.tenantId!==input.tenantId||prior.statementId!==id||prior.createdBy!==actorId||prior.requestDigest!==requestDigest)throw new CertificateError("Request ID belongs to another snapshot request",409,"REQUEST_CONFLICT");return {id:prior.id,replayed:true};}
  const captured=await capture(tx,input.tenantId,id);
  if(captured.digest!==input.expectedDigest)throw new CertificateError("Reconciliation changed. Refresh the snapshot preview before saving",409,"STALE_SOURCE");
  await tx.bankReconciliationCertificate.create({data:{id:input.requestId,tenantId:input.tenantId,...s,statementId:id,note:input.note,createdBy:actorId,requestDigest,...captured,summary:captured.snapshot.summary}});
  await audit(tx,input.tenantId,actorId,input.requestId,"BankReconciliationCertificate","bank-certificate.created",{statementId:id,digest:captured.digest});return {id:input.requestId,replayed:false};
 },options);
}
export async function listCertificates(actorId:string,tenantId:string,id:string,page=0) {
 return db.$transaction(async tx=>{
  await tenantLock(tx,tenantId);await statementAccess(tx,actorId,tenantId,id);
  const rows=await tx.bankReconciliationCertificate.findMany({where:{tenantId,statementId:id},select:{id:true,createdAt:true,observedAt:true,note:true,digest:true,summary:true},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*25,take:26});
  const certificates=await Promise.all(rows.slice(0,25).map(async r=>{const event=await tx.bankReconciliationCertificateEvent.findFirst({where:{certificateId:r.id,tenantId},orderBy:{sequence:"desc"},select:{sequence:true,action:true,replacementId:true}});return {...r,version:event?.sequence??0,supersededBy:event?.action==="SUPERSEDE"?event.replacementId:null};}));
  return {certificates,nextPage:rows.length>25?page+1:null};
 },options);
}
export async function getCertificate(actorId:string,tenantId:string,id:string) {
 return db.$transaction(async tx=>{
  await tenantLock(tx,tenantId);const certificate=await tx.bankReconciliationCertificate.findFirst({where:{id,tenantId},select:{id:true,tenantId:true,companyId:true,accountId:true,statementId:true,createdAt:true,observedAt:true,createdBy:true,note:true,digest:true,snapshot:true}});
  if(!certificate)throw new CertificateError("Snapshot not found",404);await requireAccess(tx,actorId,tenantId,certificate.companyId);
  const events=await tx.bankReconciliationCertificateEvent.findMany({where:{tenantId,certificateId:id},select:{id:true,sequence:true,action:true,replacementId:true,reason:true,createdAt:true,createdBy:true},orderBy:{sequence:"asc"}}),last=events.at(-1);
  return {certificate,events,version:last?.sequence??0,supersededBy:last?.action==="SUPERSEDE"?last.replacementId:null,canManage:await allowed(tx,actorId,tenantId,certificate.companyId,"manage")};
 },options);
}
export async function recordCertificateEvent(actorId:string,id:string,input:CertificateEventInput) {
 return db.$transaction(async tx=>{
  await tenantLock(tx,input.tenantId);const source=await tx.bankReconciliationCertificate.findFirst({where:{id,tenantId:input.tenantId},select:{companyId:true,accountId:true}});
  if(!source)throw new CertificateError("Snapshot not found",404);await requireAccess(tx,actorId,input.tenantId,source.companyId,"manage");
  await tx.$queryRaw`SELECT id FROM "BankReconciliationCertificate" WHERE id=${id}::uuid FOR UPDATE`;
  const requestDigest=certificateHash({actorId,id,...input}),prior=await tx.bankReconciliationCertificateEvent.findUnique({where:{id:input.requestId}});
  if(prior){if(prior.tenantId!==input.tenantId||prior.certificateId!==id||prior.createdBy!==actorId||prior.requestDigest!==requestDigest)throw new CertificateError("Request ID belongs to another snapshot event",409,"REQUEST_CONFLICT");return {id:prior.id,replayed:true};}
  const last=await tx.bankReconciliationCertificateEvent.findFirst({where:{certificateId:id},orderBy:{sequence:"desc"}});
  if((last?.sequence??0)!==input.expectedVersion)throw new CertificateError("Snapshot designation changed. Reload before trying again",409,"STALE_DESIGNATION");
  if(input.action==="RESTORE"&&last?.action!=="SUPERSEDE"||input.action==="SUPERSEDE"&&last?.action==="SUPERSEDE")throw new CertificateError("Invalid snapshot designation transition",409,"STALE_DESIGNATION");
  await tx.bankReconciliationCertificateEvent.create({data:{id:input.requestId,tenantId:input.tenantId,...source,certificateId:id,sequence:input.expectedVersion+1,action:input.action,replacementId:input.action==="SUPERSEDE"?input.replacementId:null,reason:input.reason,requestDigest,createdBy:actorId}});
  await audit(tx,input.tenantId,actorId,input.requestId,"BankReconciliationCertificateEvent",`bank-certificate.${input.action.toLowerCase()}`,{certificateId:id,sequence:input.expectedVersion+1});return {id:input.requestId,replayed:false};
 },options);
}
export function certificateFailure(error:unknown) {
 const headers={"Cache-Control":"private, no-store"};
 if(error instanceof Error&&/Snapshot (?:source limit exceeded|allocation history limit exceeded|outstanding limit exceeded|exceeds 16 MiB)/.test(error.message))return apiJson({error:"Snapshot exceeds its source, allocation history, outstanding or size limit",code:"SOURCE_LIMIT"},{status:413,headers});
 if(error instanceof CertificateError)return apiJson({error:error.message,...(error.code?{code:error.code}:{})},{status:error.status,headers});
 if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2002")return apiJson({error:"The request ID conflicts with a saved request. Keep the original request and verify its account and result.",code:"REQUEST_CONFLICT"},{status:409,headers});
 const constraint=error instanceof Prisma.PrismaClientUnknownRequestError&&error.message.includes("23514")||error instanceof Prisma.PrismaClientKnownRequestError&&(["P2003","P2004"].includes(error.code)||error.code==="P2010"&&["23503","23514"].includes(String(error.meta?.code)));
 if(constraint)return apiJson({error:"Snapshot sources or designation conflict with saved records. This attempt was rejected; reload before creating a new request.",code:"REJECTED"},{status:409,headers});
 if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2034")return apiJson({error:"Concurrent changes interrupted the transaction. Retry the original saved request.",code:"RETRY_REQUEST"},{status:409,headers});
 throw error;
}
