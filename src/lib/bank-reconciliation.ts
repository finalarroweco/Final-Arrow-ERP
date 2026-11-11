import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {canAccess} from "./access";
import {bankStatementInput} from "./bank-statement-input";
export {bankScope,bankStatementInput} from "./bank-statement-input";
import {certificateSnapshot,CertificateError,type BankCertificateInputsV2} from "./bank-certificate-snapshot";
import {moneyMillis,moneyText} from "./exact-money";
export class BankError extends Error{constructor(message:string,public status=409,public code?:string){super(message);}}
export async function bankAllowed(userId:string,tenantId:string,companyId:string,write=false){return (await Promise.all([canAccess({userId,tenantId,companyId,permission:"ledger:read"}),...(write?[canAccess({userId,tenantId,companyId,permission:"ledger:post"})]:[])])).every(Boolean);}
export async function lockBankAccount(tx:Prisma.TransactionClient,tenantId:string,companyId:string,accountId:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "LedgerAccount" WHERE id=${accountId}::uuid AND "tenantId"=${tenantId}::uuid AND "companyId"=${companyId}::uuid AND type='ASSET' FOR UPDATE`;
 if(!rows.length)throw new BankError("Choose a bank asset account in this company",404);
}
export function normalizedStatement(s:z.infer<typeof bankStatementInput>){
 const data={...s,opening:new Prisma.Decimal(s.opening).toFixed(3),closing:new Prisma.Decimal(s.closing).toFixed(3),lines:s.lines.map(l=>({...l,amount:new Prisma.Decimal(l.amount).toFixed(3)}))};
 if(data.lines.some(l=>new Prisma.Decimal(l.amount).eq(0)||l.bookingDate<data.from||l.bookingDate>data.to))throw new BankError("Each movement must be nonzero and inside the statement dates",400);
 const calculated=data.lines.reduce((n,l)=>n+moneyMillis(l.amount),moneyMillis(data.opening));
 if(calculated!==moneyMillis(data.closing))throw new BankError("Opening balance plus signed movements must equal closing balance",400);
 return {...data,requestHash:createHash("sha256").update(JSON.stringify(data)).digest("hex")};
}
/** Read Committed authorization precedes this single coherent source observation. */
export async function reconciliation(tx:Prisma.TransactionClient,id:string,tenantId:string){
 const scope=await tx.bankStatement.findFirst({where:{id,tenantId},select:{companyId:true,accountId:true}});
 if(!scope)throw new BankError("Statement not found",404);
 await lockBankAccount(tx,tenantId,scope.companyId,scope.accountId);
 let inputs:BankCertificateInputsV2;
 try{
  const [row]=await tx.$queryRaw<{inputs:BankCertificateInputsV2|null}[]>`SELECT erp_bank_reconciliation_inputs(${id}::uuid,${tenantId}::uuid) AS inputs`;
  if(!row?.inputs)throw new BankError("Statement not found",404);inputs=row.inputs;
 }catch(error){
  if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==="P2010"&&String(error.meta?.message).match(/limit exceeded|16 MiB/))throw new BankError("Reconciliation exceeds bounded source or allocation history limits",413);
  throw error;
 }
 try{
  const snapshot=certificateSnapshot(inputs),signed=(original:string,magnitude:string)=>moneyText(moneyMillis(original)<BigInt(0)?-moneyMillis(magnitude):moneyMillis(magnitude));
  return {statement:{...inputs.statement,tenantId:inputs.tenantId,companyId:inputs.companyId,accountId:inputs.accountId,account:inputs.account,lines:inputs.bank.filter(l=>l.statementId===inputs.statementId).sort((a,b)=>a.position-b.position).map(l=>({id:l.id,position:l.position,bookingDate:l.bookingDate,reference:l.reference,amount:l.amount,allocatedAmount:l.allocated,remainingAmount:signed(l.amount,l.currentRemaining),cutoffRemainingAmount:signed(l.amount,l.cutoffRemaining),matches:l.allocations.map(m=>({...m,journalLine:{id:m.journalLineId!,entry:{id:m.entryId!,number:m.entryNumber!,entryDate:m.entryDate!}}}))}))},...snapshot.summary,outstanding:inputs.book.filter(l=>moneyMillis(l.cutoffRemaining)!==BigInt(0)).map(l=>({id:l.id,amount:l.amount,allocatedAmount:l.allocated,remainingAmount:signed(l.amount,l.currentRemaining),cutoffRemainingAmount:signed(l.amount,l.cutoffRemaining),entry:{id:l.entryId,number:l.entryNumber,entryDate:l.entryDate,currency:l.currency,description:l.description}}))};
 }catch(error){if(error instanceof CertificateError)throw new BankError(error.message,error.status,error.code);throw error;}
}
