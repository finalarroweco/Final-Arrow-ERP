import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser,endSession,hashPassword,verifyPassword} from "@/lib/auth";
import {db} from "@/lib/db";
import {reserveLoginAttempt} from "@/lib/login-throttle";
const schema=z.object({currentPassword:z.string().min(1).max(1024),newPassword:z.string().min(12).max(128)}).strict().refine(data=>data.currentPassword!==data.newPassword);
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Use a different password between 12 and 128 characters"},{status:400});
 const attempt=await reserveLoginAttempt(actor.email,"password");
 if(!attempt.allowed)return NextResponse.json({error:"Too many attempts"},{status:429,headers:{"Retry-After":String(attempt.retryAfter),"Cache-Control":"no-store"}});
 const user=await db.user.findUnique({where:{id:actor.id},select:{passwordHash:true}});
 if(!user||!(await verifyPassword(parsed.data.currentPassword,user.passwordHash)))return NextResponse.json({error:"Current password is incorrect"},{status:403});
 const passwordHash=await hashPassword(parsed.data.newPassword);
 const changed=await db.$transaction(async tx=>{
  const update=await tx.user.updateMany({where:{id:actor.id,passwordHash:user.passwordHash},data:{passwordHash}});
  if(update.count!==1)return false;
  await tx.session.deleteMany({where:{userId:actor.id}});
  await tx.recoveryCode.deleteMany({where:{userId:actor.id}});return true;
 });
 if(!changed)return NextResponse.json({error:"Account changed. Sign in again."},{status:409});
 await endSession();
 return NextResponse.json({ok:true,signInRequired:true},{headers:{"Cache-Control":"no-store"}});
}
