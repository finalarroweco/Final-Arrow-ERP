import {Prisma} from "@prisma/client";
import {db} from "./db";
import {certificateHash} from "./bank-certificate-snapshot";
import {BankError,lockBankAccount} from "./bank-reconciliation";
import {bankTenantLock,requireBankAccess,bankAudit} from "./bank-allocation";
import type {BankRequest} from "./bank-allocation-input";
const digest=(actorId:string,statementId:string,request:BankRequest)=>certificateHash({actorId,statementId,request});
export async function bankRequestGuard(tx:Prisma.TransactionClient,actorId:string,statementId:string,request:BankRequest){
 if(!request.requestId)return; // Legacy cancellation/void has no recoverable client UUID.
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'bank-request:'+request.requestId},0))::text`;
 const prior=await tx.bankRequestResolution.findUnique({where:{id:request.requestId}});
 if(prior){if(prior.requestDigest!==digest(actorId,statementId,request))throw new BankError("Request ID belongs to another resolution",409,"REQUEST_CONFLICT");if(prior.outcome==="ABANDONED")throw new BankError("This request was permanently abandoned. Start a new request only after refreshing balances.",409,"REQUEST_ABANDONED");}
 if((request.action==="cancel"||request.action==="void")&&await tx.bankMatch.findUnique({where:{id:request.requestId},select:{id:true}}))throw new BankError("Request ID belongs to an allocation",409,"REQUEST_CONFLICT");
}
export async function bankRequestCommitted(tx:Prisma.TransactionClient,actorId:string,statementId:string,request:BankRequest){
 if(!request.requestId)return;
 const prior=await tx.bankRequestResolution.findUnique({where:{id:request.requestId}});if(prior)return;
 const s=await tx.bankStatement.findUniqueOrThrow({where:{id:statementId},select:{companyId:true,accountId:true}}),requestDigest=digest(actorId,statementId,request);
 await tx.bankRequestResolution.create({data:{id:request.requestId,tenantId:request.tenantId,...s,statementId,actorId,requestDigest,request,outcome:"COMMITTED"}});
 await bankAudit(tx,request.tenantId,actorId,request.requestId,"BankRequestResolution","bank-request.committed",{statementId,requestDigest});
}
/** Serializes against the original mutation; a tombstone blocks every delayed retry. */
export async function resolveBankRequest(actorId:string,statementId:string,request:BankRequest){
 if(!request.requestId)throw new BankError("Legacy requests require original-account outcome review",409,"LEGACY_REQUEST");
 const requestId=request.requestId;
 return db.$transaction(async tx=>{
  await bankTenantLock(tx,request.tenantId);
  const s=await tx.bankStatement.findFirst({where:{id:statementId,tenantId:request.tenantId},select:{companyId:true,accountId:true,voidedAt:true,voidedBy:true,voidReason:true}});if(!s)throw new BankError("Statement not found",404);
  await requireBankAccess(tx,actorId,request.tenantId,s.companyId,true);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'bank-request:'+requestId},0))::text`;
  await lockBankAccount(tx,request.tenantId,s.companyId,s.accountId);
  const requestDigest=digest(actorId,statementId,request),prior=await tx.bankRequestResolution.findUnique({where:{id:requestId}});
  const abandoned=()=>({outcome:"abandoned" as const,id:requestId,statementId,actorId,tenantId:request.tenantId,companyId:s.companyId,accountId:s.accountId,requestDigest,request});
  if(prior){if(prior.tenantId!==request.tenantId||prior.statementId!==statementId||prior.actorId!==actorId||prior.requestDigest!==requestDigest)throw new BankError("Request ID belongs to another resolution",409,"REQUEST_CONFLICT");if(prior.outcome==="ABANDONED")return abandoned();}
  const committed=async(match:Awaited<ReturnType<typeof tx.bankMatch.findUniqueOrThrow>>)=>{await bankRequestCommitted(tx,actorId,statementId,request);return {outcome:"committed" as const,result:{match:{...match,amount:match.amount.toFixed(3)},replayed:true,statementId,actorId,requestId}};};
  if(request.action==="allocate"||request.action==="match"){
   const m=await tx.bankMatch.findUnique({where:{id:requestId},include:{bankLine:{select:{statementId:true}}}});
   if(m){if(m.tenantId!==request.tenantId||m.companyId!==s.companyId||m.accountId!==s.accountId||m.createdBy!==actorId||m.bankLine.statementId!==statementId||m.bankLineId!==request.bankLineId||m.journalLineId!==request.journalLineId||m.kind!==request.action||(request.action==="allocate"&&!m.amount.eq(request.amount)))throw new BankError("Request ID belongs to another allocation",409,"REQUEST_CONFLICT");return committed(m);}
  }else if(request.action==="cancel"){
   const m=await tx.bankMatch.findFirst({where:{id:request.matchId,tenantId:request.tenantId,companyId:s.companyId,accountId:s.accountId,bankLine:{statementId}}});
   if(!m)throw new BankError("Allocation not found",404);
   if(m.cancelledAt&&m.cancelledBy===actorId&&m.cancelReason===request.reason)return committed(m);
  }else {
   const latest=await tx.bankStatement.findUniqueOrThrow({where:{id:statementId},select:{voidedAt:true,voidedBy:true,voidReason:true}});
   if(latest.voidedAt&&latest.voidedBy===actorId&&latest.voidReason===request.reason){await bankRequestCommitted(tx,actorId,statementId,request);return {outcome:"committed" as const,result:{id:statementId,replayed:true,tenantId:request.tenantId,actorId,reason:request.reason,requestId}};}
  }
  if(prior)throw new BankError("Committed request requires review",409,"REQUEST_CONFLICT");
  await tx.bankRequestResolution.create({data:{id:requestId,tenantId:request.tenantId,companyId:s.companyId,accountId:s.accountId,statementId,actorId,requestDigest,request,outcome:"ABANDONED"}});
  await bankAudit(tx,request.tenantId,actorId,requestId,"BankRequestResolution","bank-request.abandoned",{statementId,requestDigest});return abandoned();
 },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});
}
