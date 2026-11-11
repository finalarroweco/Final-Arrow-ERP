import {NextResponse} from "next/server";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {lockBankAccount,BankError} from "@/lib/bank-reconciliation";
import {bankFailure,bankExpectedActor} from "@/lib/bank-response";
import {bankRequestGuard,bankRequestCommitted} from "@/lib/bank-request-resolution";
import {bankUuid,bankVoidInput} from "@/lib/bank-allocation-input";
import {bankTenantLock,requireBankAccess,bankAudit} from "@/lib/bank-allocation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 try{
  bankExpectedActor(request,actor.id);
  const {id:rawId}=await params,idResult=bankUuid.safeParse(rawId),parsed=bankVoidInput.safeParse(await request.json().catch(()=>null));
  if(!idResult.success||!parsed.success)return NextResponse.json({error:"Invalid statement correction"},{status:400});
  const id=idResult.data,{tenantId,reason}=parsed.data;
  const result=await db.$transaction(async tx=>{
   await bankTenantLock(tx,tenantId);
   const s=await tx.bankStatement.findFirst({where:{id,tenantId},select:{companyId:true,accountId:true}});if(!s)throw new BankError("Statement not found",404);
   await requireBankAccess(tx,actor.id,tenantId,s.companyId,true);await bankRequestGuard(tx,actor.id,id,parsed.data);await lockBankAccount(tx,tenantId,s.companyId,s.accountId);
   const saved=await tx.bankStatement.findUniqueOrThrow({where:{id}}),response=async(replayed:boolean)=>{await bankRequestCommitted(tx,actor.id,id,parsed.data);return {id,replayed,tenantId,actorId:actor.id,reason,...(parsed.data.requestId?{requestId:parsed.data.requestId}:{})};};
   if(saved.voidedAt){if(saved.voidReason!==reason||saved.voidedBy!==actor.id)throw new BankError("Statement already voided by another request");return response(true);}
   if(await tx.bankMatch.count({where:{tenantId,cancelledAt:null,bankLine:{statementId:id}}}))throw new BankError("Cancel active allocations before voiding this statement");
   await tx.bankStatement.update({where:{id},data:{voidedAt:new Date(),voidedBy:actor.id,voidReason:reason}});
   await bankAudit(tx,tenantId,actor.id,id,"BankStatement","bank-statement.voided",{reason,accountId:s.accountId});return response(false);
  },{timeout:15000,maxWait:10000,isolationLevel:"ReadCommitted"});return NextResponse.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return bankFailure(e);}
}
