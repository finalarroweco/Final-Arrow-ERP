import {Prisma,type StockTransfer} from "@prisma/client";
import {z} from "zod";
import {canAccess} from "./access";
import {db} from "./db";
import {canonicalTransferRequest,stockTransferRequest,type StockTransferRequest,stockTransferScope} from "./stock-transfer-input";
export class StockTransferError extends Error{constructor(message:string,public status=409){super(message);}}
export async function transferRights(tx:Prisma.TransactionClient,userId:string,t:{tenantId:string;companyId:string;sourceBranchId:string;destinationBranchId:string},write=false){
 for(const branchId of [t.sourceBranchId,t.destinationBranchId])for(const permission of write?["inventory-stock:read","inventory-stock:adjust","inventory-transfer:manage"]:["inventory-stock:read"]){
  if(!(await canAccess({userId,tenantId:t.tenantId,companyId:t.companyId,branchId,permission},tx)))return false;
 }return true;
}
export function transferView(t:StockTransfer){return {...t,quantity:t.quantity.toFixed(3),createdAt:t.createdAt.toISOString()};}
async function authorize(tx:Prisma.TransactionClient,actorId:string,input:StockTransferRequest){
 if(input.expectedActorId!==actorId)throw new StockTransferError("Saved request belongs to a different user",403);
 let source;
 if(input.action==="correct"){
  source=await tx.stockTransfer.findFirst({where:{id:input.transferId,tenantId:input.tenantId,companyId:input.companyId}});
  if(!source)throw new StockTransferError("Transfer not found",404);
 }
 const scope=source??(input as Extract<StockTransferRequest,{action:"transfer"}>);
 if(!(await transferRights(tx,actorId,scope,true)))throw new StockTransferError("Both branch stock and transfer permissions are required",403);
 return source;
}
export async function createStockTransfer(actorId:string,input:StockTransferRequest){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${input.tenantId}::uuid FOR SHARE`;
  const source=await authorize(tx,actorId,input);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-transfer:'+input.requestId},0))`;
  const payload=input.action==="transfer"?{sourceBranchId:input.sourceBranchId,destinationBranchId:input.destinationBranchId,itemId:input.itemId,quantity:input.quantity,reference:input.reference,unit:input.expectedUnit,correctsId:null}:{sourceBranchId:source!.destinationBranchId,destinationBranchId:source!.sourceBranchId,itemId:source!.itemId,quantity:source!.quantity,reference:source!.reference,unit:source!.unit,correctsId:source!.id};
  const saved=await tx.stockTransfer.findUnique({where:{id:input.requestId}});
  if(saved){if(saved.tenantId!==input.tenantId||saved.companyId!==input.companyId||saved.createdBy!==actorId||saved.reason!==input.reason||saved.sourceBranchId!==payload.sourceBranchId||saved.destinationBranchId!==payload.destinationBranchId||saved.itemId!==payload.itemId||!saved.quantity.eq(payload.quantity)||saved.reference!==payload.reference||saved.unit!==payload.unit||saved.correctsId!==payload.correctsId)throw new StockTransferError("Request ID was used for different transfer details");return transferView(saved);}
  if(await tx.stockTransferCancellation.findUnique({where:{id:input.requestId}}))throw new StockTransferError("Request was permanently cancelled. Start a new request.");
  if(source&&(source.correctsId||await tx.stockTransfer.findUnique({where:{correctsId:source.id},select:{id:true}})))throw new StockTransferError("Transfer is already corrected or is itself a correction");
  const savedNew=await tx.stockTransfer.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,createdBy:actorId,reason:input.reason,...payload}});
  return transferView(savedNew);
 },{timeout:20000,maxWait:10000});
}
export async function readStockTransfer(userId:string,id:string,tenantId?:string){
 const parsedId=z.string().uuid().safeParse(id);if(!parsedId.success)return null;
 id=parsedId.data.toLowerCase();tenantId=tenantId?.toLowerCase();
 return db.$transaction(async tx=>{
  const scope=await tx.stockTransfer.findUnique({where:{id},select:{tenantId:true,companyId:true,sourceBranchId:true,destinationBranchId:true}});
  if(!scope||(tenantId&&scope.tenantId!==tenantId))return null;
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${scope.tenantId}::uuid FOR SHARE`;
  if(!(await transferRights(tx,userId,scope)))return null;
  const row=await tx.stockTransfer.findUniqueOrThrow({where:{id},include:{corrections:true}});
  const canCorrect=!row.correctsId&&!row.corrections.length&&await transferRights(tx,userId,scope,true);
  return {...transferView(row),corrections:row.corrections.map(transferView),canCorrect};
 },{timeout:15000,maxWait:10000});
}
export const transferFilters=stockTransferScope.extend({expectedActorId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),page:z.coerce.number().int().min(0).max(100000).default(0),sourceBranchId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),destinationBranchId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),itemId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),q:z.string().trim().max(120).optional(),format:z.enum(["json","csv"]).default("json")}).strict();
export async function listStockTransfers(userId:string,f:z.infer<typeof transferFilters>){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${f.tenantId}::uuid FOR SHARE`;
  const branches=await tx.branch.findMany({where:{tenantId:f.tenantId,companyId:f.companyId},select:{id:true}});
  const readable:string[]=[];
  for(const branch of branches)if(await canAccess({userId,tenantId:f.tenantId,companyId:f.companyId,branchId:branch.id,permission:"inventory-stock:read"},tx))readable.push(branch.id);
  if(readable.length<2)throw new StockTransferError("Both branch stock read permissions are required",403);
  const where:Prisma.StockTransferWhereInput={tenantId:f.tenantId,companyId:f.companyId,sourceBranchId:{in:readable},destinationBranchId:{in:readable},AND:[...(f.sourceBranchId?[{sourceBranchId:f.sourceBranchId}]:[]),...(f.destinationBranchId?[{destinationBranchId:f.destinationBranchId}]:[])],...(f.itemId?{itemId:f.itemId}:{}),...(f.q?{OR:[{reference:{contains:f.q,mode:"insensitive"}},{itemName:{contains:f.q,mode:"insensitive"}},{itemSku:{contains:f.q,mode:"insensitive"}}]}:{})};
  const rows=await tx.stockTransfer.findMany({where,orderBy:[{createdAt:"desc"},{id:"asc"}],skip:f.format==="csv"?0:f.page*50,take:f.format==="csv"?5001:51});
  if(f.format==="csv"&&rows.length>5000)throw new StockTransferError("Export exceeds 5000 transfers. Narrow the filters.",413);
  return {transfers:rows.slice(0,f.format==="csv"?5000:50).map(transferView),page:f.page,nextPage:f.format==="json"&&rows.length>50?f.page+1:null};
 },{timeout:15000,maxWait:10000});
}

export async function cancelStockTransferRequest(actorId:string,input:StockTransferRequest){
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${input.tenantId}::uuid FOR SHARE`;
  const source=await authorize(tx,actorId,input);
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'stock-transfer:'+input.requestId},0))`;
  const saved=await tx.stockTransfer.findUnique({where:{id:input.requestId}});
  if(saved){
   const matches=input.action==="transfer"?saved.correctsId===null&&saved.sourceBranchId===input.sourceBranchId&&saved.destinationBranchId===input.destinationBranchId&&saved.itemId===input.itemId&&saved.quantity.eq(input.quantity)&&saved.reference===input.reference&&saved.unit===input.expectedUnit:saved.correctsId===source!.id;
   if(!matches||saved.tenantId!==input.tenantId||saved.companyId!==input.companyId||saved.createdBy!==actorId||saved.reason!==input.reason)throw new StockTransferError("Request ID belongs to different transfer details");
   return {transfer:transferView(saved)};
  }
  const request=canonicalTransferRequest(input);
  const old=await tx.stockTransferCancellation.findUnique({where:{id:input.requestId}});
  if(old){
   // Parse into the stable input schema: JSONB object key ordering is not significant.
   const parsed=stockTransferRequest.safeParse(old.request);
   if(old.createdBy!==actorId||old.tenantId!==input.tenantId||old.companyId!==input.companyId||!parsed.success||JSON.stringify(canonicalTransferRequest(parsed.data))!==JSON.stringify(request))throw new StockTransferError("Request ID belongs to different cancelled details");
   return {cancellation:{...old,createdAt:old.createdAt.toISOString(),request}};
  }
  const cancellation=await tx.stockTransferCancellation.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,createdBy:actorId,request}});
  return {cancellation:{...cancellation,createdAt:cancellation.createdAt.toISOString(),request}};
 },{timeout:15000,maxWait:10000});
}
