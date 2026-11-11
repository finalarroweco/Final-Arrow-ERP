import type {Prisma} from "@prisma/client";
import {randomUUID} from "node:crypto";
import {db} from "./db";
import {bankTenantLock,requireBankAccess} from "./bank-allocation";
import {normalizedStatement,lockBankAccount,BankError} from "./bank-reconciliation";
import type {BankStatementInput} from "./bank-statement-input";
const receiptSelect={id:true,tenantId:true,companyId:true,accountId:true,requestHash:true,createdBy:true} as const;
type Saved={id:string;tenantId:string;companyId:string;accountId:string;requestHash:string;createdBy:string};
// UUID equality is canonical; original UUID text remains in the historical digest.
function verifySaved(saved:Saved,data:ReturnType<typeof normalizedStatement>,actorId:string){
 if(saved.tenantId.toLowerCase()!==data.tenantId.toLowerCase()||saved.companyId.toLowerCase()!==data.companyId.toLowerCase()||saved.accountId.toLowerCase()!==data.accountId.toLowerCase()||saved.requestHash!==data.requestHash||saved.createdBy.toLowerCase()!==actorId.toLowerCase())throw new BankError("Request ID belongs to another statement or original account",409,"REQUEST_CONFLICT");
}
function importReceipt(saved:Saved,actorId:string,replayed:boolean){return {...saved,requestId:saved.id,actorId,replayed};}
type Cancelled=Saved & {cancelledAt:Date;auditId:string};
function abandonedReceipt(saved:Cancelled,actorId:string){return {outcome:"ABANDONED" as const,result:{requestId:saved.id,tenantId:saved.tenantId,companyId:saved.companyId,accountId:saved.accountId,requestHash:saved.requestHash,createdBy:saved.createdBy,actorId,cancelledAt:saved.cancelledAt.toISOString(),auditId:saved.auditId}};}
// The account must precede this lock: old application versions already hold it
// when their INSERT reaches the database's UUID guard.
async function importLocks(tx:Prisma.TransactionClient,actorId:string,input:BankStatementInput,write:boolean){
 await bankTenantLock(tx,input.tenantId);
 await requireBankAccess(tx,actorId,input.tenantId,input.companyId.toLowerCase(),write);
 await lockBankAccount(tx,input.tenantId,input.companyId,input.accountId);
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'bank-statement-import:'+input.requestId.toLowerCase()},0))::text`;
 // Refresh authorization after every potentially blocking serialization lock.
 await requireBankAccess(tx,actorId,input.tenantId,input.companyId.toLowerCase(),write);
}
export async function importBankStatement(actorId:string,input:BankStatementInput){
 const data=normalizedStatement(input);const {tenantId,companyId}=input;return db.$transaction(async tx=>{
  await importLocks(tx,actorId,input,true);
  const saved=await tx.bankStatement.findUnique({where:{id:data.requestId},select:{id:true,tenantId:true,companyId:true,requestHash:true,accountId:true,createdBy:true}});
  if(saved){verifySaved(saved,data,actorId);return importReceipt(saved,actorId,true);}
  const cancelled=await tx.bankStatementImportCancellation.findUnique({where:{id:data.requestId}});
  if(cancelled){verifySaved(cancelled,data,actorId);throw new BankError("Import request was permanently abandoned",409,"REQUEST_ABANDONED");}
  const company=await tx.company.findUnique({where:{tenantId_id:{tenantId,id:companyId}},select:{baseCurrency:true}});if(!company)throw new BankError("Company not found",404);
  if(await tx.bankStatement.findFirst({where:{accountId:data.accountId,voidedAt:null,from:{lte:new Date(data.to)},to:{gte:new Date(data.from)}}}))throw new BankError("Statement period overlaps a saved statement");
  const statement=await tx.bankStatement.create({data:{id:data.requestId,tenantId,companyId,accountId:data.accountId,reference:data.reference,from:new Date(data.from),to:new Date(data.to),opening:data.opening,closing:data.closing,currency:company.baseCurrency,requestHash:data.requestHash,createdBy:actorId},select:receiptSelect});
  if(data.lines.length)await tx.bankStatementLine.createMany({data:data.lines.map((l,position)=>({id:randomUUID(),tenantId,companyId,accountId:data.accountId,statementId:statement.id,position,bookingDate:new Date(l.bookingDate),reference:l.reference,amount:l.amount}))});
  await tx.auditLog.create({data:{tenantId,actorId:actorId,entity:"BankStatement",entityId:statement.id,action:"bank-statement.imported",metadata:{accountId:data.accountId,reference:data.reference,movements:data.lines.length,from:data.from,to:data.to}}});return importReceipt(statement,actorId,false);
 },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});
}
// Read-only observation. UNKNOWN cannot fence a delayed send or prove safe abandonment.
export async function checkBankStatementImport(actorId:string,input:BankStatementInput){
 const data=normalizedStatement(input);
 return db.$transaction(async tx=>{
  await importLocks(tx,actorId,input,false);
  const saved=await tx.bankStatement.findUnique({where:{id:input.requestId},select:receiptSelect});
  if(!saved){
   const cancelled=await tx.bankStatementImportCancellation.findUnique({where:{id:input.requestId}});
   if(cancelled){verifySaved(cancelled,data,actorId);return abandonedReceipt(cancelled,actorId);}
   return {outcome:"UNKNOWN" as const,actorId,requestId:input.requestId,tenantId:input.tenantId,companyId:input.companyId,accountId:input.accountId,requestHash:data.requestHash};
  }
  verifySaved(saved,data,actorId);return {outcome:"COMMITTED" as const,result:importReceipt(saved,actorId,true)};
 },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});
}

/** Durable technical cancellation. No statement, line, allocation or ledger mutation. */
export async function abandonBankStatementImport(actorId:string,input:BankStatementInput){
 const data=normalizedStatement(input);
 return db.$transaction(async tx=>{
  await importLocks(tx,actorId,input,true);
  const saved=await tx.bankStatement.findUnique({where:{id:input.requestId},select:receiptSelect});
  if(saved){verifySaved(saved,data,actorId);return {outcome:"COMMITTED" as const,result:importReceipt(saved,actorId,true)};}
  const existing=await tx.bankStatementImportCancellation.findUnique({where:{id:input.requestId}});
  if(existing){verifySaved(existing,data,actorId);return abandonedReceipt(existing,actorId);}
  // The INSERT trigger binds the immutable cancellation and its audit to this
  // database transaction. Returning happens only after the transaction commits.
  const cancelled=await tx.bankStatementImportCancellation.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,accountId:input.accountId,requestHash:data.requestHash,createdBy:actorId}});
  return abandonedReceipt(cancelled,actorId);
 },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});
}
