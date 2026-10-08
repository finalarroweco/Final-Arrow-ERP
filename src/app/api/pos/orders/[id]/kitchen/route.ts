import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
class KitchenConflict extends Error{}
const previous={PREPARING:"WAITING",READY:"PREPARING",SERVED:"READY"} as const;
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await context.params;
 const parsed=z.object({tenantId:z.string().uuid(),status:z.enum(["PREPARING","READY","SERVED"])}).strict().safeParse(await request.json().catch(()=>null));
 if(!parsed.success||!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"Invalid kitchen transition"},{status:400});
 const order=await db.posOrder.findFirst({where:{id,tenantId:parsed.data.tenantId},select:{id:true,tenantId:true,companyId:true,branchId:true}});
 if(!order)return NextResponse.json({error:"Order not found"},{status:404});
 if(!(await canAccess({userId:actor.id,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const status=parsed.data.status;
 try{await db.$transaction(async(tx)=>{await tx.$queryRaw`SELECT "id" FROM "PosOrder" WHERE "id" = ${id}::uuid FOR UPDATE`;const [clock]=await tx.$queryRaw<{stamp:Date}[]>`SELECT clock_timestamp() AS stamp`;const stamp=clock.stamp;const changed=await tx.posOrder.updateMany({where:{id,status:{not:"CANCELLED"},kitchenStatus:previous[status]},data:{kitchenStatus:status,...(status==="PREPARING"?{prepStartedAt:stamp}:status==="READY"?{readyAt:stamp}:{servedAt:stamp})}});if(changed.count!==1)throw new KitchenConflict();await tx.auditLog.create({data:{tenantId:order.tenantId,actorId:actor.id,action:`pos-kitchen.${status.toLowerCase()}`,entity:"PosOrder",entityId:id}});});return NextResponse.json({ok:true});}
 catch(error){if(error instanceof KitchenConflict)return NextResponse.json({error:"Order cancelled or kitchen status changed; refresh"},{status:409});throw error;}
}
