import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {posMoney} from "@/lib/pos";
const schema=z.discriminatedUnion("action",[
 z.object({tenantId:z.string().uuid(),action:z.literal("pay"),method:z.literal("CASH"),tendered:posMoney}).strict(),
 z.object({tenantId:z.string().uuid(),action:z.literal("pay-card"),reference:z.string().trim().min(3).max(200)}).strict(),
 z.object({tenantId:z.string().uuid(),action:z.literal("cancel"),reason:z.string().trim().min(3).max(500)}).strict()
]);
class OrderConflict extends Error{}
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await context.params;
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success||!z.string().uuid().safeParse(id).success)return NextResponse.json({error:"Invalid order action"},{status:400});
 const order=await db.posOrder.findFirst({where:{id,tenantId:parsed.data.tenantId}});if(!order)return NextResponse.json({error:"Order not found"},{status:404});
 if(!(await canAccess({userId:actor.id,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 if(order.status!=="OPEN")return NextResponse.json({error:"Only open orders can be paid or cancelled"},{status:409});
 const data:Prisma.PosOrderUpdateManyMutationInput=parsed.data.action==="cancel"?{status:"CANCELLED",cancelledAt:new Date(),cancelReason:parsed.data.reason}:
 parsed.data.action==="pay-card"?{status:"PAID",paidAt:new Date(),paymentMethod:"CARD",paymentReference:parsed.data.reference}:{status:"PAID",paidAt:new Date(),paymentMethod:"CASH",tendered:new Prisma.Decimal(parsed.data.tendered),change:new Prisma.Decimal(parsed.data.tendered).minus(order.total)};
 if(parsed.data.action==="pay"&&new Prisma.Decimal(parsed.data.tendered).lt(order.total))return NextResponse.json({error:"Cash tendered is below the order total"},{status:400});
 try{await db.$transaction(async(tx)=>{const changed=await tx.posOrder.updateMany({where:{id,status:"OPEN"},data});if(changed.count!==1)throw new OrderConflict();await tx.auditLog.create({data:{tenantId:order.tenantId,actorId:actor.id,action:parsed.data.action==="cancel"?"pos-order.cancelled":"pos-order.paid",entity:"PosOrder",entityId:id}});});return NextResponse.json({ok:true});}
 catch(error){if(error instanceof OrderConflict)return NextResponse.json({error:"Order changed; refresh and retry"},{status:409});throw error;}
}
