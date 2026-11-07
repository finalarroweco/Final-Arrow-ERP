import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,lockBankAccount,BankError} from "@/lib/bank-reconciliation";
import {bankFailure} from "@/lib/bank-response";
const uuid=z.string().uuid();
const schema=z.discriminatedUnion("action",[z.object({tenantId:uuid,requestId:uuid,action:z.literal("match"),bankLineId:uuid,journalLineId:uuid}).strict(),z.object({tenantId:uuid,action:z.literal("cancel"),matchId:uuid,reason:z.string().trim().min(3).max(300)}).strict()]);
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,parsed=schema.safeParse(await request.json().catch(()=>null));if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid match"},{status:400});
 const p=parsed.data,s=await db.bankStatement.findFirst({where:{id,tenantId:p.tenantId},select:{companyId:true,accountId:true,to:true,currency:true,voidedAt:true}});if(!s)return NextResponse.json({error:"Statement not found"},{status:404});if(!(await bankAllowed(actor.id,p.tenantId,s.companyId,true)))return NextResponse.json({error:"Company-wide ledger read/post permission required"},{status:403});
 try{const result=await db.$transaction(async tx=>{
  await lockBankAccount(tx,p.tenantId,s.companyId,s.accountId);
  if(p.action==="cancel"){
   const saved=await tx.bankMatch.findFirst({where:{id:p.matchId,tenantId:p.tenantId,bankLine:{statementId:id}}});if(!saved)throw new BankError("Match not found",404);
   if(saved.cancelledAt){if(saved.cancelReason!==p.reason)throw new BankError("Match already cancelled with another reason");return {match:saved,replayed:true};}
   const match=await tx.bankMatch.update({where:{id:saved.id},data:{cancelledAt:new Date(),cancelledBy:actor.id,cancelReason:p.reason}});
   await tx.auditLog.create({data:{tenantId:p.tenantId,actorId:actor.id,entity:"BankMatch",entityId:match.id,action:"bank-match.cancelled",metadata:{statementId:id,bankLineId:saved.bankLineId,journalLineId:saved.journalLineId,reason:p.reason}}});return {match,replayed:false};
  }
  const saved=await tx.bankMatch.findUnique({where:{id:p.requestId},include:{bankLine:{select:{statementId:true}}}});if(saved){if(saved.bankLine.statementId!==id||saved.tenantId!==p.tenantId||saved.companyId!==s.companyId||saved.accountId!==s.accountId||saved.bankLineId!==p.bankLineId||saved.journalLineId!==p.journalLineId)throw new BankError("Retry ID belongs to another match");return {match:saved,replayed:true};}
  if((await tx.bankStatement.findUnique({where:{id},select:{voidedAt:true}}))?.voidedAt)throw new BankError("Statement is voided");
  const bank=await tx.bankStatementLine.findFirst({where:{id:p.bankLineId,tenantId:p.tenantId,statementId:id}}),journal=await tx.journalLine.findFirst({where:{id:p.journalLineId,tenantId:p.tenantId,companyId:s.companyId,accountId:s.accountId},include:{entry:{select:{entryDate:true,currency:true}}}});
  if(!bank||!journal)throw new BankError("Choose a bank movement and book movement from this account",404);
  if(!bank.amount.eq(journal.debit.minus(journal.credit))||journal.entry.currency!==s.currency||journal.entry.entryDate>s.to)throw new BankError("Amount, direction, currency or journal date does not match");
  if(await tx.bankMatch.findFirst({where:{cancelledAt:null,OR:[{bankLineId:bank.id},{journalLineId:journal.id}]}}))throw new BankError("Movement already has an active match");
  const match=await tx.bankMatch.create({data:{id:p.requestId,tenantId:p.tenantId,companyId:s.companyId,accountId:s.accountId,bankLineId:bank.id,journalLineId:journal.id,createdBy:actor.id}});
  await tx.auditLog.create({data:{tenantId:p.tenantId,actorId:actor.id,entity:"BankMatch",entityId:match.id,action:"bank-match.created",metadata:{statementId:id,bankLineId:bank.id,journalLineId:journal.id}}});return {match,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(e){return bankFailure(e);}
}
