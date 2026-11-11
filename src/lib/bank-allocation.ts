import {Prisma} from "@prisma/client";
import {db} from "./db";
import {scopeMatches} from "./scope";
import {BankError,lockBankAccount} from "./bank-reconciliation";
import {bankRequestGuard,bankRequestCommitted} from "./bank-request-resolution";
import type {BankMatchInput} from "./bank-allocation-input";
export async function bankTenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
export async function requireBankAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string,companyId:string,write=false){
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 if(member?.status!=="ACTIVE")throw new BankError("Active membership required",403);
 const permissions=["ledger:read",...(write?["ledger:post"]:[])];
 const grants=await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:permissions}},select:{permissionKey:true}}}}}});
 if(!permissions.every(permission=>grants.some(g=>g.role.permissions.some(p=>p.permissionKey===permission)&&g.scopes.some(s=>scopeMatches(s,{companyId})))))throw new BankError("Company-wide ledger read/post permission required",403);
}
export async function bankAudit(tx:Prisma.TransactionClient,tenantId:string,actorId:string,id:string,entity:string,action:string,metadata:Record<string,string>){
 const [clock]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
 await tx.auditLog.create({data:{tenantId,actorId,entity,entityId:id,action,metadata:{...metadata,transaction:clock.transaction}}});
}
export async function allocateBank(actorId:string,id:string,p:BankMatchInput){
 return db.$transaction(async tx=>{
  await bankTenantLock(tx,p.tenantId);
  const s=await tx.bankStatement.findFirst({where:{id,tenantId:p.tenantId},select:{companyId:true,accountId:true,to:true,currency:true}});
  if(!s)throw new BankError("Statement not found",404);
  await requireBankAccess(tx,actorId,p.tenantId,s.companyId,true);await bankRequestGuard(tx,actorId,id,p);await lockBankAccount(tx,p.tenantId,s.companyId,s.accountId);
  const response=async(match:Awaited<ReturnType<typeof tx.bankMatch.findUniqueOrThrow>>,replayed:boolean)=>{await bankRequestCommitted(tx,actorId,id,p);return {match:{...match,amount:match.amount.toFixed(3)},replayed,statementId:id,actorId,...(p.requestId?{requestId:p.requestId}:{})};};
  if(p.action==="cancel"){
   const saved=await tx.bankMatch.findFirst({where:{id:p.matchId,tenantId:p.tenantId,bankLine:{statementId:id}}});if(!saved)throw new BankError("Allocation not found",404);
   if(saved.cancelledAt){if(saved.cancelReason!==p.reason||saved.cancelledBy!==actorId)throw new BankError("Allocation already cancelled by another request");return response(saved,true);}
   const match=await tx.bankMatch.update({where:{id:saved.id},data:{cancelledAt:new Date(),cancelledBy:actorId,cancelReason:p.reason}});
   await bankAudit(tx,p.tenantId,actorId,match.id,"BankMatch","bank-match.cancelled",{statementId:id,bankLineId:saved.bankLineId,journalLineId:saved.journalLineId,amount:saved.amount.toFixed(3),kind:saved.kind,reason:p.reason});return response(match,false);
  }
  const saved=await tx.bankMatch.findUnique({where:{id:p.requestId},include:{bankLine:{select:{statementId:true}}}});
  if(saved){if(saved.bankLine.statementId!==id||saved.tenantId!==p.tenantId||saved.companyId!==s.companyId||saved.accountId!==s.accountId||saved.bankLineId!==p.bankLineId||saved.journalLineId!==p.journalLineId||saved.createdBy!==actorId||saved.kind!==p.action||(p.action==="allocate"&&!saved.amount.eq(p.amount)))throw new BankError("Retry ID belongs to another allocation");return response(saved,true);}
  if((await tx.bankStatement.findUnique({where:{id},select:{voidedAt:true}}))?.voidedAt)throw new BankError("Statement is voided");
  const bank=await tx.bankStatementLine.findFirst({where:{id:p.bankLineId,tenantId:p.tenantId,statementId:id}}),journal=await tx.journalLine.findFirst({where:{id:p.journalLineId,tenantId:p.tenantId,companyId:s.companyId,accountId:s.accountId},include:{entry:{select:{entryDate:true,currency:true}}}});
  if(!bank||!journal)throw new BankError("Choose bank and book movements from this account",404);
  const bookAmount=journal.debit.minus(journal.credit);
  if(bookAmount.isZero()||bank.amount.isPositive()!==bookAmount.isPositive()||journal.entry.currency!==s.currency||journal.entry.entryDate>s.to)throw new BankError("Direction, currency or journal date does not match");
  if(p.action==="match"){
   if(!bank.amount.eq(bookAmount))throw new BankError("Amount, direction, currency or journal date does not match");
   if(await tx.bankMatch.findFirst({where:{cancelledAt:null,OR:[{bankLineId:bank.id},{journalLineId:journal.id}]}}))throw new BankError("Movement already has an active match");
  }
  const amount=p.action==="allocate"?new Prisma.Decimal(p.amount):bank.amount.abs();
  const bankAllocated=await tx.bankMatch.aggregate({where:{bankLineId:bank.id,cancelledAt:null},_sum:{amount:true}}),bookAllocated=await tx.bankMatch.aggregate({where:{journalLineId:journal.id,cancelledAt:null},_sum:{amount:true}});
  if(amount.plus(bankAllocated._sum.amount??0).gt(bank.amount.abs())||amount.plus(bookAllocated._sum.amount??0).gt(bookAmount.abs()))throw new BankError("Allocation exceeds the currently available bank or book amount");
  const match=await tx.bankMatch.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:s.companyId,accountId:s.accountId,bankLineId:bank.id,journalLineId:journal.id,createdBy:actorId,amount,kind:p.action}});
  await bankAudit(tx,p.tenantId,actorId,match.id,"BankMatch","bank-match.created",{statementId:id,bankLineId:bank.id,journalLineId:journal.id,amount:amount.toFixed(3),kind:p.action});return response(match,false);
 },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});
}
