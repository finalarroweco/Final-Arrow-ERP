import {Prisma} from "@prisma/client";
import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,requestId:uuid,reason:z.string().trim().min(3).max(150),lines:z.array(z.object({receiptLineId:uuid,quantity:z.number().int().min(1).max(100000)}).strict()).min(1).max(50)}).strict();
class ReturnConflict extends Error {constructor(message:string,public status=409){super(message);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await params,parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid stock return: submit positive whole quantities and a request ID"},{status:400});
 const {tenantId,requestId,reason,lines}=parsed.data;
 if(new Set(lines.map(l=>l.receiptLineId)).size!==lines.length)return NextResponse.json({error:"Submit each receipt line once"},{status:400});
 const receipt=await db.goodsReceipt.findUnique({where:{tenantId_id:{tenantId,id}},select:{companyId:true,branchId:true,order:{select:{branchId:true}}}});
 if(!receipt)return NextResponse.json({error:"Receipt not found"},{status:404});
 const scope={userId:actor.id,tenantId,companyId:receipt.companyId};
 const rights=await Promise.all([canAccess({...scope,branchId:receipt.branchId,permission:"inventory-stock:read"}),canAccess({...scope,branchId:receipt.branchId,permission:"inventory-stock:adjust"}),canAccess({...scope,branchId:receipt.order.branchId??undefined,permission:"purchase-order:read"}),canAccess({...scope,branchId:receipt.order.branchId??undefined,permission:"purchase-order:manage"})]);
 if(!rights.every(Boolean))return NextResponse.json({error:"Forbidden"},{status:403});
 try{
  const result=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "GoodsReceipt" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
   const saved=await tx.goodsReturn.findUnique({where:{id:requestId},include:{lines:true}});
   if(saved){
    if(saved.tenantId!==tenantId||saved.receiptId!==id||saved.reason!==reason||saved.lines.length!==lines.length||saved.lines.some(l=>!lines.some(q=>q.receiptLineId===l.receiptLineId&&q.quantity===l.quantity)))throw new ReturnConflict("Request ID was already used for a different return");
    return {goodsReturn:saved,replayed:true};
   }
   const ids=lines.map(l=>l.receiptLineId);
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "StockMovement" WHERE "tenantId"=${tenantId}::uuid AND "receiptLineId" IN (${Prisma.join(ids.map(v=>Prisma.sql`${v}::uuid`))}) ORDER BY id FOR UPDATE`);
   const sources=await tx.goodsReceiptLine.findMany({where:{tenantId,receiptId:id,id:{in:ids}},include:{movement:true}});
   if(sources.length!==lines.length)throw new ReturnConflict("A line is outside this receipt",400);
   const reversed=await tx.auditLog.count({where:{tenantId,entity:"StockMovement",entityId:{in:sources.flatMap(l=>l.movement?[l.movement.id]:[])},action:"inventory-stock.reversed"}});
   if(reversed||sources.some(l=>!l.movement||l.movement.type!=="PURCHASE_RECEIPT"))throw new ReturnConflict("A receipt movement is missing or already reversed");
   for(const source of sources)if(source.quantity.minus(source.returnedQuantity).lt(lines.find(l=>l.receiptLineId===source.id)!.quantity))throw new ReturnConflict("Return exceeds remaining receipt quantity");
   const balances=[...new Set(sources.map(l=>l.movement!.balanceId))];
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "StockBalance" WHERE "tenantId"=${tenantId}::uuid AND id IN (${Prisma.join(balances.map(v=>Prisma.sql`${v}::uuid`))}) ORDER BY id FOR UPDATE`);
   const header=await tx.goodsReturn.create({data:{id:requestId,tenantId,receiptId:id,reason,createdBy:actor.id}});
   for(const source of sources.sort((a,b)=>a.id.localeCompare(b.id))){
    const quantity=lines.find(l=>l.receiptLineId===source.id)!.quantity;
    const changed=await tx.stockBalance.updateMany({where:{id:source.movement!.balanceId,tenantId,quantity:{gte:quantity}},data:{quantity:{decrement:quantity}}});
    if(changed.count!==1)throw new ReturnConflict("Insufficient stock in the receiving branch");
    const line=await tx.goodsReturnLine.create({data:{tenantId,receiptId:id,returnId:header.id,receiptLineId:source.id,quantity}});
    await tx.stockMovement.create({data:{tenantId,balanceId:source.movement!.balanceId,type:"PURCHASE_RETURN",delta:-quantity,reason:`Goods return ${header.id}: ${reason}`,actorId:actor.id,returnLineId:line.id}});
   }
   await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"GoodsReturn",entityId:header.id,action:"purchase-order.stock_returned",metadata:{receiptId:id,branchId:receipt.branchId,reason}}});
   return {goodsReturn:await tx.goodsReturn.findUniqueOrThrow({where:{id:header.id},include:{lines:true}}),replayed:false};
  },{timeout:20000,maxWait:10000});
  return NextResponse.json(result,{status:201});
 }catch(error){
  if(error instanceof ReturnConflict)return NextResponse.json({error:error.message},{status:error.status});
  if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004","P2034"].includes(error.code))return NextResponse.json({error:"Stock return conflict. Retry the same request."},{status:409});
  throw error;
 }
}
