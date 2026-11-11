import {Prisma,type SalesStockDocument} from "@prisma/client";
import {z} from "zod";
import {db} from "./db";
import {canAccess} from "./access";
import {canonicalSalesStockRequest,salesStockResponseMatches,salesStockCancellationMatches,salesStockScope,type SalesStockRequest} from "./sales-stock-input";
export class SalesStockError extends Error{constructor(message:string,public status=409){super(message);}}
export function salesStockView(row:SalesStockDocument){return {...row,quantity:row.quantity.toFixed(3),delta:row.delta.toFixed(3),createdAt:row.createdAt.toISOString()};}
async function orderRights(tx:Prisma.TransactionClient,actorId:string,scope:{tenantId:string;companyId:string;orderId:string},write=false,coherent=false){
 if(coherent)await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id=${scope.orderId}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid FOR SHARE`;
 const order=await tx.salesOrder.findFirst({where:{id:scope.orderId,tenantId:scope.tenantId,companyId:scope.companyId},select:{id:true,branchId:true,status:true}});
 if(!order)throw new SalesStockError("Order not found",404);
 for(const permission of write?["order:read","order-delivery:manage"]:["order:read"])
  if(!await canAccess({userId:actorId,tenantId:scope.tenantId,companyId:scope.companyId,branchId:order.branchId??undefined,permission},tx))throw new SalesStockError("Order access required",403);
 return order;
}
async function stockRights(tx:Prisma.TransactionClient,actorId:string,scope:{tenantId:string;companyId:string;branchId:string},write=false){
 for(const permission of write?["inventory-stock:read","inventory-stock:adjust"]:["inventory-stock:read"])
  if(!await canAccess({userId:actorId,...scope,permission},tx))return false;
 return true;
}
async function authorize(tx:Prisma.TransactionClient,actorId:string,input:SalesStockRequest){
 if(input.expectedActorId!==actorId)throw new SalesStockError("Saved request belongs to a different signed-in user",403);
 const order=await orderRights(tx,actorId,input,true);
 const source=input.action==='deliver'?null:await tx.salesStockDocument.findFirst({where:{id:input.action==='return'?input.deliveryId:input.documentId,tenantId:input.tenantId,companyId:input.companyId,orderId:input.orderId}});
 if(input.action!=='deliver'&&!source)throw new SalesStockError("Source stock document not found",404);
 const branchId=input.action==='deliver'?input.branchId:source!.branchId;
 if(!await stockRights(tx,actorId,{tenantId:input.tenantId,companyId:input.companyId,branchId},true))throw new SalesStockError("Stock read and adjustment access required",403);
 if(order.branchId&&order.branchId!==branchId)throw new SalesStockError("Stock branch must match the source order");
 if(input.action==='deliver'&&input.holdId&&!await canAccess({userId:actorId,tenantId:input.tenantId,companyId:input.companyId,branchId:order.branchId??undefined,permission:'order-reservation:manage'},tx))throw new SalesStockError("Order hold management access also required",403);
 return source;
}
async function requestLock(tx:Prisma.TransactionClient,input:SalesStockRequest){
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'sales-stock:'+input.requestId},0))`;
 // Both request mutexes precede item/balance/order locks, including explicit abandonment.
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-reservation-request:'+input.requestId},0))`;
}
export async function createSalesStockDocument(actorId:string,input:SalesStockRequest){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${input.tenantId}::uuid FOR SHARE`;
  const source=await authorize(tx,actorId,input);await requestLock(tx,input);
  const saved=await tx.salesStockDocument.findUnique({where:{id:input.requestId}});
  if(saved){if(!salesStockResponseMatches(input,salesStockView(saved)))throw new SalesStockError("Request ID belongs to different stock document details");return salesStockView(saved);}
  if(await tx.salesStockCancellation.findUnique({where:{id:input.requestId}}))throw new SalesStockError("Request was permanently abandoned. Prepare a new request.");
  const common={id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,orderId:input.orderId,createdBy:actorId,unit:input.expectedUnit,reason:input.reason,physicalConfirmed:true};
  const data=input.action==='deliver'?{...common,kind:'DELIVERY',branchId:input.branchId,itemId:input.itemId,lineId:input.lineId,holdId:input.holdId,releaseRequestId:input.holdId?input.requestId:null,quantity:input.quantity,reference:input.reference}
   :{...common,kind:input.action==='return'?'RETURN':'CORRECTION',branchId:source!.branchId,itemId:source!.itemId,lineId:source!.lineId,quantity:input.action==='return'?input.quantity:source!.quantity,reference:input.action==='return'?input.reference:source!.reference,deliveryId:input.action==='return'?source!.id:null,correctsId:input.action==='correct'?source!.id:null};
  return salesStockView(await tx.salesStockDocument.create({data}));
 },{timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function cancelSalesStockRequest(actorId:string,input:SalesStockRequest){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${input.tenantId}::uuid FOR SHARE`;
  await authorize(tx,actorId,input);await requestLock(tx,input);
  const saved=await tx.salesStockDocument.findUnique({where:{id:input.requestId}});
  if(saved){const document=salesStockView(saved);if(!salesStockResponseMatches(input,document))throw new SalesStockError("Request ID belongs to different stock document details");return {document};}
  const old=await tx.salesStockCancellation.findUnique({where:{id:input.requestId}});
  if(old){const cancellation={...old,createdAt:old.createdAt.toISOString()};if(!salesStockCancellationMatches(input,cancellation))throw new SalesStockError("Request ID belongs to different abandoned details");return {cancellation};}
  const request=canonicalSalesStockRequest(input),row=await tx.salesStockCancellation.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,createdBy:actorId,request}});
  return {cancellation:{...row,createdAt:row.createdAt.toISOString(),request}};
 },{timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export async function readSalesStockDocument(actorId:string,id:string,tenantId:string){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
  const row=await tx.salesStockDocument.findFirst({where:{id,tenantId}});if(!row)return null;
  try{await orderRights(tx,actorId,row,false,true);}catch(e){if(e instanceof SalesStockError)return null;throw e;}
  if(!await stockRights(tx,actorId,row))return null;
  const corrections=await tx.salesStockDocument.findMany({where:{correctsId:id}});
  const returns=row.kind==='DELIVERY'?await tx.salesStockDocument.findMany({where:{deliveryId:id,kind:'RETURN'},orderBy:[{createdAt:'asc'},{id:'asc'}],take:5001}):[];
  if(returns.length>5000)throw new SalesStockError("Source history exceeds 5000 returns. Use the filtered register to inspect or export history; this complete detail cannot be printed.",413);
  const returnCorrections=returns.length?await tx.salesStockDocument.findMany({where:{correctsId:{in:returns.map(r=>r.id)}},take:5001}):[];
  if(returnCorrections.length>5000)throw new SalesStockError("Source correction history exceeds the complete-detail limit. Use the filtered register.",413);
  const corrected=new Set(returnCorrections.map(r=>r.correctsId));
  const effectiveReturns=returns.filter(r=>!corrected.has(r.id)).reduce((sum,r)=>sum.plus(r.quantity),new Prisma.Decimal(0));
  let write=false;try{await orderRights(tx,actorId,row,true);write=await stockRights(tx,actorId,row,true);}catch(e){if(!(e instanceof SalesStockError))throw e;}
  const item=await tx.inventoryItem.findUnique({where:{id:row.itemId},select:{unit:true}});
  const currentUnit=item?.unit===row.unit;
  const remaining=corrections.length?new Prisma.Decimal(0):row.quantity.minus(effectiveReturns);
  return {document:salesStockView(row),corrections:corrections.map(salesStockView),returns:returns.map(salesStockView),returnCorrections:returnCorrections.map(salesStockView),canCorrect:write&&currentUnit&&row.kind!=='CORRECTION'&&!corrections.length&&(row.kind==='RETURN'||effectiveReturns.eq(0)),canReturn:write&&currentUnit&&row.kind==='DELIVERY'&&!corrections.length&&remaining.gt(0),returnableQuantity:row.kind==='DELIVERY'?remaining.toFixed(3):'0.000'};
 },{timeout:15000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
export const salesStockFilters=salesStockScope.extend({expectedActorId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),page:z.coerce.number().int().min(0).max(100000).default(0),branchId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),itemId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),q:z.string().trim().max(120).optional(),format:z.enum(['json','csv']).default('json')}).strict();
export async function listSalesStockDocuments(actorId:string,f:z.infer<typeof salesStockFilters>){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.tenantId}::uuid FOR SHARE`;
  const order=await orderRights(tx,actorId,f,false,true);
  const branches=await tx.branch.findMany({where:{tenantId:f.tenantId,companyId:f.companyId,...(order.branchId?{id:order.branchId}:{})},select:{id:true}});
  const readable:string[]=[];for(const b of branches)if(await stockRights(tx,actorId,{...f,branchId:b.id}))readable.push(b.id);
  if(!readable.length)throw new SalesStockError("Stock read access required",403);
  const where:Prisma.SalesStockDocumentWhereInput={tenantId:f.tenantId,companyId:f.companyId,orderId:f.orderId,branchId:{in:readable},AND:[...(f.branchId?[{branchId:f.branchId}]:[])],...(f.itemId?{itemId:f.itemId}:{}),...(f.q?{OR:[{reference:{contains:f.q,mode:'insensitive'}},{itemName:{contains:f.q,mode:'insensitive'}},{itemSku:{contains:f.q,mode:'insensitive'}}]}:{})};
  const rows=await tx.salesStockDocument.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:f.format==='csv'?0:f.page*50,take:f.format==='csv'?5001:51});
  if(f.format==='csv'&&rows.length>5000)throw new SalesStockError("Export exceeds 5000 documents. Narrow the filters.",413);
  // SQL aggregation retains exact decimals and separates historical units. No commercial demand denominator exists.
  const groups=await tx.salesStockDocument.groupBy({by:['branchId','itemId','unit','kind'],where,_sum:{quantity:true,delta:true},_min:{branchName:true,itemName:true,itemSku:true},orderBy:[{branchId:'asc'},{itemId:'asc'},{unit:'asc'},{kind:'asc'}],take:5001});
  if(groups.length>5000)throw new SalesStockError("Register totals exceed 5000 item/unit/kind groups. Narrow branch, item or search filters.",413);
  const totals=new Map<string,{branchId:string;branchName:string;itemId:string;itemName:string;itemSku:string;unit:string;delivered:Prisma.Decimal;returned:Prisma.Decimal;deliveryCorrections:Prisma.Decimal;returnCorrections:Prisma.Decimal;netOut:Prisma.Decimal}>();
  for(const g of groups){const key=[g.branchId,g.itemId,g.unit].join(':');let t=totals.get(key);if(!t){t={branchId:g.branchId,branchName:g._min.branchName??'',itemId:g.itemId,itemName:g._min.itemName??'',itemSku:g._min.itemSku??'',unit:g.unit,delivered:new Prisma.Decimal(0),returned:new Prisma.Decimal(0),deliveryCorrections:new Prisma.Decimal(0),returnCorrections:new Prisma.Decimal(0),netOut:new Prisma.Decimal(0)};totals.set(key,t);}const q=g._sum.quantity??new Prisma.Decimal(0),d=g._sum.delta??new Prisma.Decimal(0);t.netOut=t.netOut.minus(d);if(g.kind==='DELIVERY')t.delivered=t.delivered.plus(q);else if(g.kind==='RETURN')t.returned=t.returned.plus(q);else {t.deliveryCorrections=t.deliveryCorrections.plus(q.plus(d).div(2));t.returnCorrections=t.returnCorrections.plus(q.minus(d).div(2));}}
  return {documents:rows.slice(0,f.format==='csv'?5000:50).map(salesStockView),page:f.page,nextPage:f.format==='json'&&rows.length>50?f.page+1:null,totals:[...totals.values()].map(t=>({...t,delivered:t.delivered.toFixed(3),returned:t.returned.toFixed(3),deliveryCorrections:t.deliveryCorrections.toFixed(3),returnCorrections:t.returnCorrections.toFixed(3),netOut:t.netOut.toFixed(3)}))};
 },{timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
}
