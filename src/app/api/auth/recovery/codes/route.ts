import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser,verifyPassword} from "@/lib/auth";
import {reserveLoginAttempt} from "@/lib/login-throttle";
import {makeRecoveryCodes,recoveryHeaders} from "@/lib/recovery";
export async function GET(){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401,headers:recoveryHeaders});
 const count=await db.recoveryCode.count({where:{userId:actor.id}});return NextResponse.json({count},{headers:recoveryHeaders});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401,headers:recoveryHeaders});
 const input=z.object({currentPassword:z.string().min(1).max(1024)}).strict().safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Invalid request"},{status:400,headers:recoveryHeaders});
 const attempt=await reserveLoginAttempt(actor.email,"recovery-setup");if(!attempt.allowed)return NextResponse.json({error:"Too many attempts"},{status:429,headers:{...recoveryHeaders,"Retry-After":String(attempt.retryAfter)}});
 const user=await db.user.findUnique({where:{id:actor.id},select:{passwordHash:true}});if(!user||!(await verifyPassword(input.data.currentPassword,user.passwordHash)))return NextResponse.json({error:"Current password is incorrect"},{status:403,headers:recoveryHeaders});
 const codes=makeRecoveryCodes();const saved=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id}::uuid FOR UPDATE`;
  const current=await tx.user.findUnique({where:{id:actor.id},select:{passwordHash:true}});if(current?.passwordHash!==user.passwordHash)return false;
  await tx.recoveryCode.deleteMany({where:{userId:actor.id}});await tx.recoveryCode.createMany({data:codes.map(c=>({userId:actor.id,codeHash:c.codeHash}))});
  const memberships=await tx.membership.findMany({where:{userId:actor.id},select:{tenantId:true}});for(const m of memberships)await tx.auditLog.create({data:{tenantId:m.tenantId,actorId:actor.id,action:"account.recovery-codes.replaced",entity:"User",entityId:actor.id,metadata:{count:10}}});return true;
 });
 if(!saved)return NextResponse.json({error:"Account changed. Sign in again."},{status:409,headers:recoveryHeaders});
 return NextResponse.json({codes:codes.map(c=>c.code)},{status:201,headers:recoveryHeaders});
}
