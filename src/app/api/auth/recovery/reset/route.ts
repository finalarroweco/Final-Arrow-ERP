import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {hashPassword,verifyPassword,endSession} from "@/lib/auth";
import {reserveLoginAttempt} from "@/lib/login-throttle";
import {normalizeRecoveryCode,recoveryHash,recoveryHeaders} from "@/lib/recovery";
const schema=z.object({email:z.string().trim().email().max(254),code:z.string().min(1).max(80),newPassword:z.string().min(12).max(128)}).strict();
export async function POST(request:Request){
 const input=schema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Invalid recovery request"},{status:400,headers:recoveryHeaders});
 const email=input.data.email.toLowerCase(),attempt=await reserveLoginAttempt(email,"recovery");if(!attempt.allowed)return NextResponse.json({error:"Too many attempts"},{status:429,headers:{...recoveryHeaders,"Retry-After":String(attempt.retryAfter)}});
 const user=await db.user.findUnique({where:{email},select:{id:true,passwordHash:true}}),code=normalizeRecoveryCode(input.data.code);
 // Spend the same password-hashing work for unknown accounts and invalid codes.
 const passwordHash=await hashPassword(input.data.newPassword),samePassword=await verifyPassword(input.data.newPassword,user?.passwordHash??`${"0".repeat(32)}:${"0".repeat(128)}`);
 const changed=user&&code?await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
  const current=await tx.user.findUnique({where:{id:user.id},select:{passwordHash:true}});
  const saved=await tx.recoveryCode.findFirst({where:{userId:user.id,codeHash:recoveryHash(code)}});
  if(!saved||current?.passwordHash!==user.passwordHash||samePassword)return false;
  await tx.user.update({where:{id:user.id},data:{passwordHash}});
  await tx.session.deleteMany({where:{userId:user.id}});await tx.recoveryCode.deleteMany({where:{userId:user.id}});
  const memberships=await tx.membership.findMany({where:{userId:user.id},select:{tenantId:true}});for(const m of memberships)await tx.auditLog.create({data:{tenantId:m.tenantId,actorId:user.id,action:"account.recovered",entity:"User",entityId:user.id,metadata:{sessionsRevoked:true,recoveryCodesRevoked:true}}});return true;
 }):false;
 if(!changed)return NextResponse.json({error:"Recovery details are invalid or the new password is unchanged"},{status:403,headers:recoveryHeaders});
 await endSession();return NextResponse.json({ok:true,signInRequired:true},{headers:recoveryHeaders});
}
