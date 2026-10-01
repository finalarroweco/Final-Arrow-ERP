import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {posMoney} from "@/lib/pos";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params;const parsed=z.object({tenantId:z.string().uuid(),active:z.boolean().optional(),name:z.string().trim().min(2).max(200).optional(),category:z.string().trim().min(2).max(80).optional(),price:posMoney.refine(value=>Number(value)>0).optional()}).strict().refine(value=>value.active!==undefined||value.name!==undefined||value.category!==undefined||value.price!==undefined).safeParse(await request.json().catch(()=>null));
 if(!parsed.success||!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"Invalid item update"},{status:400});
 const item=await db.posItem.findFirst({where:{id,tenantId:parsed.data.tenantId}});if(!item)return NextResponse.json({error:"Item not found"},{status:404});
 if(!(await canAccess({userId:actor.id,tenantId:item.tenantId,companyId:item.companyId,branchId:item.branchId??undefined,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const {tenantId:ignoredTenant,...changes}=parsed.data;
 void ignoredTenant;
 await db.$transaction(async(tx)=>{await tx.posItem.update({where:{id},data:changes});await tx.auditLog.create({data:{tenantId:item.tenantId,actorId:actor.id,action:changes.name!==undefined||changes.category!==undefined||changes.price!==undefined?"pos-item.updated":changes.active?"pos-item.activated":"pos-item.deactivated",entity:"PosItem",entityId:id,metadata:{fields:Object.keys(changes)}}});});return NextResponse.json({ok:true});
}
