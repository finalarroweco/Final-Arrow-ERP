import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,reason:z.string().trim().min(3).max(150)}).strict();
class StockConflict extends Error {}
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
  const {id}=await context.params;const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid movement reversal"},{status:400});
  const {tenantId,reason}=parsed.data;
  const original=await db.stockMovement.findFirst({where:{tenantId,id},include:{balance:true,receiptLine:{select:{receipt:{select:{order:{select:{branchId:true}}}}}}}});
  if(!original)return NextResponse.json({error:"Movement not found"},{status:404});
  const {companyId,branchId,itemId}=original.balance;
  const scope={userId:actor.id,tenantId,companyId,branchId};
  const checks=await Promise.all([canAccess({...scope,permission:"inventory-stock:read"}),canAccess({...scope,permission:"inventory-stock:adjust"}),
    ...(original.receiptLine?[canAccess({...scope,branchId:original.receiptLine.receipt.order.branchId??undefined,permission:"purchase-order:read"})]:[])]);
  if(!checks.every(Boolean))return NextResponse.json({error:"Forbidden"},{status:403});
  try{
    const result=await db.$transaction(async tx=>{
      // Serialize corrections of this exact immutable source movement.
      await tx.$queryRaw`SELECT id FROM "StockMovement" WHERE "tenantId"=${tenantId}::uuid AND id=${id}::uuid FOR UPDATE`;
      if(original.type === "PURCHASE_RETURN")throw new StockConflict("Saved stock returns cannot be reversed");
      if(original.receiptLineId){
        const source=await tx.goodsReceiptLine.findUnique({where:{id:original.receiptLineId},select:{returnedQuantity:true}});
        if(source && source.returnedQuantity>0)throw new StockConflict("Receipt has stock returns and cannot be fully reversed");
      }
      const existing=await tx.auditLog.findFirst({where:{tenantId,entity:"StockMovement",entityId:id,action:{in:["inventory-stock.reversed","inventory-stock.reversal-created"]}}});
      if(existing)throw new StockConflict("Movement is already reversed or is itself a reversal");
      const delta=original.delta.negated(),max=new Prisma.Decimal("999999999999999.999");
      if(delta.eq(0))throw new StockConflict("A zero movement cannot be reversed");
      const changed=await tx.stockBalance.updateMany({where:{id:original.balanceId,tenantId,
        quantity:delta.lt(0)?{gte:delta.negated()}:{lte:max.minus(delta)}},data:{quantity:{increment:delta}}});
      if(changed.count!==1)throw new StockConflict("Insufficient stock or balance limit reached");
      const digest=createHash("sha256").update(`final-arrow-stock-reversal:${id}`).digest("hex");
      const reversalId=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
      const movement=await tx.stockMovement.create({data:{id:reversalId,tenantId,balanceId:original.balanceId,
        type:delta.gt(0)?"ADJUSTMENT_IN":"ADJUSTMENT_OUT",delta,reason:`Reversal ${id}: ${reason}`,actorId:actor.id}});
      await tx.auditLog.createMany({data:[
        {tenantId,actorId:actor.id,action:"inventory-stock.reversed",entity:"StockMovement",entityId:id,metadata:{reversalId:movement.id,branchId,itemId,delta:delta.toString(),reason}},
        {tenantId,actorId:actor.id,action:"inventory-stock.reversal-created",entity:"StockMovement",entityId:movement.id,metadata:{originalId:id}},
      ]});
      return {movement,balance:await tx.stockBalance.findUnique({where:{id:original.balanceId},select:{itemId:true,quantity:true}})};
    },{timeout:15000,maxWait:10000});
    return NextResponse.json(result,{status:201});
  }catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")return NextResponse.json({error:"Movement already reversed"},{status:409});if(error instanceof StockConflict)return NextResponse.json({error:error.message},{status:409});throw error;}
}

