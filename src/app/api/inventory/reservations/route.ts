import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {reservationRequest,reservationScope} from "@/lib/stock-reservation-input";
const filters=reservationScope.extend({page:z.coerce.number().int().min(0).max(100000).default(0),state:z.enum(["ACTIVE","RELEASED","ALL"]).default("ACTIVE"),itemId:z.string().uuid().optional()}).strict();
class ReservationConflict extends Error{}
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 const p=filters.safeParse(Object.fromEntries(params));if(!p.success||[...params.keys()].some(k=>params.getAll(k).length!==1))return NextResponse.json({error:"Invalid reservation filters"},{status:400});
 const {tenantId,companyId,branchId,page,state,itemId}=p.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"inventory-stock:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const rows=await db.stockReservation.findMany({where:{tenantId,balance:{tenantId,companyId,branchId,...(itemId?{itemId}:{})},...(state==="ACTIVE"?{releasedAt:null}:state==="RELEASED"?{releasedAt:{not:null}}:{})},select:{id:true,balanceId:true,quantity:true,reference:true,createdAt:true,releasedAt:true,releaseReason:true,balance:{select:{itemId:true,item:{select:{sku:true,name:true,unit:true}}}}},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});
 return NextResponse.json({reservations:rows.slice(0,50),page,nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const p=reservationRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid reservation request"},{status:400});
 const input=p.data,{tenantId,companyId,branchId}=input,scope={userId:actor.id,tenantId,companyId,branchId};
 if(!(await canAccess({...scope,permission:"inventory-stock:read"}))||!(await canAccess({...scope,permission:"inventory-stock:adjust"})))return NextResponse.json({error:"Forbidden"},{status:403});
 try{
 const reservation=await db.$transaction(async tx=>{
  const where={tenantId,companyId,branchId};
  const source=input.action==="reserve"?await tx.stockBalance.findFirst({where:{...where,itemId:input.itemId}}):(await tx.stockReservation.findFirst({where:{id:input.reservationId,tenantId,balance:where},select:{balance:true}}))?.balance;
  if(!source)throw new ReservationConflict("Source stock balance is unavailable in this branch");
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${source.id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
  if(input.action==="reserve"){
   const saved=await tx.stockReservation.findUnique({where:{id:input.requestId}});
   if(saved){if(saved.tenantId!==tenantId||saved.balanceId!==source.id||saved.createdBy!==actor.id||!saved.quantity.equals(input.quantity)||saved.reference!==input.reference)throw new ReservationConflict("Request ID was used for different reservation details");return saved;}
   const current=await tx.stockBalance.findUniqueOrThrow({where:{id:source.id}});
   if(current.quantity.minus(current.reservedQuantity).lt(input.quantity))throw new ReservationConflict("Insufficient available stock. Release existing reservations first.");
   const item=await tx.inventoryItem.findUniqueOrThrow({where:{id:source.itemId},select:{archivedAt:true,tenantId:true,companyId:true,branchId:true}});
   if(item.archivedAt||item.tenantId!==tenantId||item.companyId!==companyId||(item.branchId&&item.branchId!==branchId))throw new ReservationConflict("Item is archived or outside this branch");
   if(await tx.stockReservation.count({where:{tenantId,balanceId:source.id}})>=5000)throw new ReservationConflict("Reservation history limit reached for this stock balance");
   const savedNew=await tx.stockReservation.create({data:{id:input.requestId,tenantId,balanceId:source.id,quantity:input.quantity,reference:input.reference,createdBy:actor.id}});
   await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"inventory-stock.reserved",entity:"StockReservation",entityId:savedNew.id,metadata:{balanceId:source.id,transactionId:savedNew.creationTransaction,quantity:savedNew.quantity.toFixed(3),reference:input.reference}}});
   return savedNew;
  }
  const saved=await tx.stockReservation.findUniqueOrThrow({where:{id:input.reservationId}});
  if(saved.releasedAt){if(saved.releaseRequestId!==input.requestId||saved.releasedBy!==actor.id||saved.releaseReason!==input.reason)throw new ReservationConflict("Reservation already released by another request");return saved;}
  const released=await tx.stockReservation.update({where:{id:saved.id},data:{releaseRequestId:input.requestId,releasedBy:actor.id,releaseReason:input.reason}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"inventory-stock.reservation-released",entity:"StockReservation",entityId:saved.id,metadata:{balanceId:source.id,transactionId:released.releaseTransaction,requestId:input.requestId,reason:input.reason}}});
  return released;
 },{timeout:15000,maxWait:10000});
 return NextResponse.json({reservation},{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof ReservationConflict)return NextResponse.json({error:error.message},{status:409});if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004","P2010","P2034"].includes(error.code))return NextResponse.json({error:"Reservation conflict, archived source or available stock limit. Reload and retry the same request."},{status:409});throw error;}
}
