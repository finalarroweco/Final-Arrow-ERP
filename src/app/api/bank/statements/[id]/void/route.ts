import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,lockBankAccount,BankError} from "@/lib/bank-reconciliation";
import {bankFailure} from "@/lib/bank-response";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params;
 const parsed=z.object({tenantId:z.string().uuid(),action:z.literal("void"),reason:z.string().trim().min(3).max(300)}).strict().safeParse(await request.json().catch(()=>null));if(!z.string().uuid().safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid statement correction"},{status:400});
 const {tenantId,reason}=parsed.data,s=await db.bankStatement.findFirst({where:{id,tenantId},select:{companyId:true,accountId:true}});if(!s)return NextResponse.json({error:"Statement not found"},{status:404});if(!(await bankAllowed(actor.id,tenantId,s.companyId,true)))return NextResponse.json({error:"Company-wide ledger read/post permission required"},{status:403});
 try{const result=await db.$transaction(async tx=>{
  await lockBankAccount(tx,tenantId,s.companyId,s.accountId);const saved=await tx.bankStatement.findUniqueOrThrow({where:{id}});
  if(saved.voidedAt){if(saved.voidReason!==reason)throw new BankError("Statement already voided with another reason");return {id,replayed:true};}
  if(await tx.bankMatch.count({where:{tenantId,cancelledAt:null,bankLine:{statementId:id}}}))throw new BankError("Cancel active matches before voiding this statement");
  await tx.bankStatement.update({where:{id},data:{voidedAt:new Date(),voidedBy:actor.id,voidReason:reason}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"BankStatement",entityId:id,action:"bank-statement.voided",metadata:{reason,accountId:s.accountId}}});return {id,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(e){return bankFailure(e);}
}
