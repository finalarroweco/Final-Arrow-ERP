import {Prisma} from "@prisma/client";
import {canAccess} from "./access";
import {db} from "./db";
import type {ReservationRequest} from "./stock-reservation-input";
import type {OrderStockHoldRequest} from "./order-stock-hold-input";
export class ReservationError extends Error {constructor(message:string,public status=409){super(message);}}
type ClosedOrderOutcome={actorId:string;orderId:string;orderStatus:"COMPLETED"|"CANCELLED";request:Extract<OrderStockHoldRequest,{action:"reserve"}>};
class ClosedOrderNotRecorded extends ReservationError {
 constructor(public outcome:ClosedOrderOutcome){super("This order is permanently closed. This exact request was not recorded.");}
}
export const reservationDetails={orderLink:true,balance:{select:{itemId:true,companyId:true,branchId:true,quantity:true,reservedQuantity:true,item:{select:{unit:true}}}}} satisfies Prisma.StockReservationInclude;
type Scope={tenantId:string;companyId:string;branchId:string};
export async function stockRights(tx:Prisma.TransactionClient,actorId:string,scope:Scope,manage:boolean){
 for(const permission of ["inventory-stock:read",...(manage?["inventory-stock:adjust"]:[])])if(!await canAccess({...scope,userId:actorId,permission},tx))throw new ReservationError("Forbidden",403);
}
export async function orderRights(tx:Prisma.TransactionClient,actorId:string,scope:Scope,orderId:string,manage:boolean,lock=true){
 if(lock)await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id=${orderId}::uuid AND "tenantId"=${scope.tenantId}::uuid FOR UPDATE`;
 const order=await tx.salesOrder.findFirst({where:{id:orderId,tenantId:scope.tenantId,companyId:scope.companyId}});
 if(!order)throw new ReservationError("Order not found",404);
 const auth={userId:actorId,tenantId:scope.tenantId,companyId:scope.companyId,branchId:order.branchId??undefined};
 for(const permission of ["order:read",...(manage?["order-reservation:manage"]:[])])if(!await canAccess({...auth,permission},tx))throw new ReservationError("Forbidden",403);
 if(order.branchId&&order.branchId!==scope.branchId)throw new ReservationError("Order belongs to a different branch");
 return order;
}
export async function changeReservation(actorId:string,input:ReservationRequest|OrderStockHoldRequest,orderId?:string){
 const {tenantId,companyId,branchId}=input,scope={tenantId,companyId,branchId};
 return db.$transaction(async tx=>{
  // Role/team editors take Tenant FOR UPDATE. Never authorize via a global
  // client inside this transaction (also works with a one-connection pool).
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-reservation-request:'+input.requestId.toLowerCase()},0))`;
  await stockRights(tx,actorId,scope,true);
  if(orderId&&input.action==="reserve"&&"note" in input){
   const checked=await orderRights(tx,actorId,scope,orderId,true,false);
   if(input.expectedActorId!==actorId)throw new ReservationError("The signed-in operator changed. Keep this exact request and restore the original session before retrying.");
   // Terminal orders cannot reopen through any supported lifecycle transition.
   // Under the UUID mutex, no existing reserve OR release result means this
   // request and every delayed duplicate can have no stock effect here.
   if((checked.status==="COMPLETED"||checked.status==="CANCELLED")&&!await tx.stockReservation.findFirst({where:{OR:[{id:input.requestId},{releaseRequestId:input.requestId}]},select:{id:true}}))
    throw new ClosedOrderNotRecorded({actorId,orderId,orderStatus:checked.status,request:input});
  }
  const source=input.action==="reserve"?await tx.stockBalance.findFirst({where:{...scope,itemId:input.itemId}}):(await tx.stockReservation.findFirst({where:{id:input.reservationId,tenantId,balance:scope},select:{balance:true}}))?.balance;
  if(!source){if(orderId)await orderRights(tx,actorId,scope,orderId,true,false);throw new ReservationError("Source stock balance is unavailable in this branch");}
  // Linked creation matches purchase receipt ordering: item before balance.
  // Existing unlinked/release paths never acquire an item row lock.
  if(orderId&&input.action==="reserve")await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${source.itemId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "StockBalance" WHERE id=${source.id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
  const saved=await tx.stockReservation.findUnique({where:{id:input.action==="reserve"?input.requestId:input.reservationId},include:reservationDetails});
  const linkedId=input.action==="release"?saved?.orderLink?.orderId:undefined;
  const order=orderId?await orderRights(tx,actorId,scope,orderId,true):linkedId?await orderRights(tx,actorId,scope,linkedId,true):null;
  if("expectedActorId" in input&&input.expectedActorId!==actorId)throw new ReservationError("The signed-in operator changed. Keep this exact request and restore the original session before retrying.");
  if(input.action==="reserve"){
   const reference="reference" in input?input.reference:"Order-linked manual hold";
   if(saved){
    const matches=saved.tenantId===tenantId&&saved.balanceId===source.id&&saved.createdBy===actorId&&saved.quantity.equals(input.quantity)&&saved.reference===reference&&
     (orderId?saved.sourceKind==="ORDER_MANUAL"&&saved.orderLink?.orderId===orderId&&"note" in input&&saved.orderLink.note===input.note&&saved.orderLink.itemUnit===input.expectedUnit&&saved.orderLink.lineId===(input.lineId??null):saved.sourceKind==="MANUAL"&&!saved.orderLink);
    if(!matches)throw new ReservationError("Request ID was used for different reservation details");return saved;
   }
   if(await tx.stockReservation.findUnique({where:{releaseRequestId:input.requestId},select:{id:true}}))throw new ReservationError("Request ID was already used for a release");
   if(orderId&&order&&"note" in input&&(order.status==="COMPLETED"||order.status==="CANCELLED"))throw new ClosedOrderNotRecorded({actorId,orderId,orderStatus:order.status,request:input});
   if(order&&!["NEW","IN_PROGRESS"].includes(order.status))throw new ReservationError("New manual holds require an active order; existing holds are unchanged");
   const current=await tx.stockBalance.findUniqueOrThrow({where:{id:source.id}});
   if(current.quantity.minus(current.reservedQuantity).lt(input.quantity))throw new ReservationError("Insufficient available stock. Release existing reservations first.");
   const item=await tx.inventoryItem.findUniqueOrThrow({where:{id:source.itemId}});
   if(item.archivedAt||item.tenantId!==tenantId||item.companyId!==companyId||(item.branchId&&item.branchId!==branchId))throw new ReservationError("Item is archived or outside this branch");
   if(orderId&&"expectedUnit" in input&&input.expectedUnit!==item.unit)throw new ReservationError("The stock unit changed since this request was prepared. No conversion is performed. Keep the exact request for verification.");
   if(await tx.stockReservation.count({where:{tenantId,balanceId:source.id}})>=5000)throw new ReservationError("Reservation history limit reached for this stock balance");
   const created=await tx.stockReservation.create({data:{id:input.requestId,tenantId,balanceId:source.id,sourceKind:orderId?"ORDER_MANUAL":"MANUAL",quantity:input.quantity,reference,createdBy:actorId}});
   await tx.auditLog.create({data:{tenantId,actorId,action:"inventory-stock.reserved",entity:"StockReservation",entityId:created.id,metadata:{balanceId:source.id,transactionId:created.creationTransaction,quantity:created.quantity.toFixed(3),reference}}});
   if(orderId&&order&&"note" in input){
    // Database validates the expected unit and derives authoritative snapshots.
    await tx.orderStockReservation.create({data:{reservationId:created.id,tenantId,companyId,branchId,balanceId:source.id,itemId:source.itemId,orderId,lineId:input.lineId??null,note:input.note,orderNumber:order.number,customerName:order.customerName,itemSku:item.sku,itemName:item.name,itemUnit:input.expectedUnit,branchName:""}});
    await tx.auditLog.create({data:{tenantId,actorId,action:"order-stock.reserved",entity:"OrderStockReservation",entityId:created.id,metadata:{orderId,transactionId:created.creationTransaction}}});
   }
   return tx.stockReservation.findUniqueOrThrow({where:{id:created.id},include:reservationDetails});
  }
  if(!saved||saved.tenantId!==tenantId||saved.balanceId!==source.id)throw new ReservationError("Reservation not found");
  if(orderId&&saved.orderLink?.orderId!==orderId)throw new ReservationError("Reservation does not belong to this order");
  if(saved.releasedAt){if(saved.releaseRequestId!==input.requestId||saved.releasedBy!==actorId||saved.releaseReason!==input.reason)throw new ReservationError("Reservation already released by another request");return saved;}
  if(await tx.stockReservation.findUnique({where:{id:input.requestId},select:{id:true}}))throw new ReservationError("Request ID was already used to create a reservation");
  const released=await tx.stockReservation.update({where:{id:saved.id},data:{releaseRequestId:input.requestId,releasedBy:actorId,releaseReason:input.reason},include:reservationDetails});
  await tx.auditLog.create({data:{tenantId,actorId,action:"inventory-stock.reservation-released",entity:"StockReservation",entityId:saved.id,metadata:{balanceId:source.id,transactionId:released.releaseTransaction,requestId:input.requestId,reason:linkedId?"Order-linked manual hold release":input.reason}}});
  if(linkedId)await tx.auditLog.create({data:{tenantId,actorId,action:"order-stock.released",entity:"OrderStockReservation",entityId:saved.id,metadata:{orderId:linkedId,transactionId:released.releaseTransaction,requestId:input.requestId,reason:input.reason}}});
  return released;
 },{timeout:15000,maxWait:10000});
}
export function reservationFailure(error:unknown):{error:string;status:number;code?:"NOT_RECORDED_CLOSED";outcome?:ClosedOrderOutcome}{
 if(error instanceof ClosedOrderNotRecorded)return {error:error.message,status:error.status,code:"NOT_RECORDED_CLOSED",outcome:error.outcome};
 if(error instanceof ReservationError)return {error:error.message,status:error.status};
 if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004","P2010","P2034"].includes(error.code))return {error:"Reservation conflict, changed source or available stock limit. Keep the same request for verification.",status:409};
 if(error instanceof Prisma.PrismaClientUnknownRequestError&&error.message.includes('code: "23514"'))return {error:"Reservation source or stock constraint conflict. Keep the same request for verification.",status:409};
 throw error;
}
