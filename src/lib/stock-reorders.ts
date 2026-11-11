import {Prisma,type InventoryReorderRequest} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {loadReorderAccess} from './stock-reorder-access';
import {canonicalReorderRequest,reorderResponseMatches,reorderCancellationMatches,reorderEvent,reorderPolicy,reorderFilters,reorderItemFilters,type ReorderRequest} from './stock-reorder-input';
export class ReorderError extends Error{constructor(message:string,public status=409){super(message);}}
const options={timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
function cancellation(row:InventoryReorderRequest){return {id:row.id,tenantId:row.tenantId,companyId:row.companyId,branchId:row.branchId,policyId:row.policyId,itemId:row.itemId,createdBy:row.createdBy,createdAt:row.createdAt.toISOString(),request:row.request};}
function savedResult(row:InventoryReorderRequest,input:ReorderRequest){
 if(JSON.stringify(canonicalReorderRequest(input))!==JSON.stringify(canonicalReorderRequest(row.request as ReorderRequest))||row.createdBy!==input.expectedActorId)throw new ReorderError('Request identity belongs to different details');
 if(row.outcome==='ABANDONED'){const c=cancellation(row);if(!reorderCancellationMatches(input,c))throw new ReorderError('Invalid saved cancellation');return {cancellation:c};}
 const event=reorderEvent.parse(row.result);if(!reorderResponseMatches(input,event))throw new ReorderError('Invalid saved reorder receipt');return {event};
}
export async function mutateReorder(actorId:string,input:ReorderRequest,abandon=false){return db.$transaction(async tx=>{
 await tenantLock(tx,input.tenantId);
 if(input.expectedActorId!==actorId)throw new ReorderError('Saved request belongs to a different signed-in user',403);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'inventory-reorder-request:'+input.requestId},0))`;
 // Lock order agrees with the database request processor. No item eligibility check on
 // recovery: current exact branch rights can recover/archive history after source moves.
 await tx.$queryRaw`SELECT id FROM "InventoryItem" WHERE id=${input.itemId}::uuid FOR SHARE`;
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'inventory-reorder:'+input.policyId},0))`;
 const access=await loadReorderAccess(tx,actorId,input.tenantId);
 if(!access.canManage(input))throw new ReorderError('Current branch stock read and reorder management access required',403);
 const saved=await tx.inventoryReorderRequest.findUnique({where:{id:input.requestId}});
 if(saved){const result=savedResult(saved,input);if(!abandon&&'cancellation'in result)throw new ReorderError('Request was permanently abandoned. Prepare a new request.');return result;}
 const row=await tx.inventoryReorderRequest.create({data:{id:input.requestId,tenantId:input.tenantId,companyId:input.companyId,branchId:input.branchId,policyId:input.policyId,itemId:input.itemId,createdBy:actorId,action:input.action,expectedVersion:input.expectedVersion,request:canonicalReorderRequest(input),outcome:abandon?'ABANDONED':'COMMITTED'}});
 return savedResult(row,input);
 },options);}
type Scope={tenantId:string;companyId:string;branchId:string};
async function authorizeRead(tx:Prisma.TransactionClient,actorId:string,scope:Scope){
 await tenantLock(tx,scope.tenantId);
 const access=await loadReorderAccess(tx,actorId,scope.tenantId);
 if(!access.canRead(scope))throw new ReorderError('Current branch stock read access required',403);
 const branch=await tx.branch.findFirst({where:{id:scope.branchId,tenantId:scope.tenantId,companyId:scope.companyId},select:{id:true}});
 if(!branch)throw new ReorderError('Branch not found',404);
 return access;
}
/** One SQL statement joins policies, present sources and present balances. No balance
 * is created for a never-stocked item; policy snapshots survive source scope changes.
 * Authorization is stable under the tenant SHARE lock, with no cross-branch union.
 */
async function observe(tx:Prisma.TransactionClient,f:z.infer<typeof reorderFilters>,id?:string){
 const cap=f.format==='csv'?5001:51,offset=f.format==='csv'?0:f.page*50;
 const rows=await tx.$queryRaw<{observedAt:Date;policies:unknown[]}[]>(Prisma.sql`
 WITH selected AS (
 SELECT p.*,CASE WHEN p.archived THEN 'ARCHIVED'
 WHEN i.id IS NULL OR i."tenantId"<>p."tenantId" OR i."companyId"<>p."companyId" OR (i."branchId" IS NOT NULL AND i."branchId"<>p."branchId") OR i."archivedAt" IS NOT NULL THEN 'SOURCE_UNAVAILABLE'
 WHEN i.unit<>p.unit OR i."reorderUnitVersion"<>p."unitVersion" THEN 'UNIT_REVIEW'
 WHEN COALESCE(b.quantity,0)-COALESCE(b."reservedQuantity",0)<p."minimumQuantity" THEN 'BELOW_MINIMUM'
 ELSE 'AT_OR_ABOVE_MINIMUM' END AS status,
 COALESCE(b.quantity,0)::numeric(18,3) AS physical,
 COALESCE(b."reservedQuantity",0)::numeric(18,3) AS reserved
 FROM "InventoryReorderPolicy" p LEFT JOIN "InventoryItem" i ON i.id=p."itemId"
 LEFT JOIN "StockBalance" b ON b."tenantId"=p."tenantId" AND b."companyId"=p."companyId" AND b."branchId"=p."branchId" AND b."itemId"=p."itemId"
 WHERE p."tenantId"=${f.tenantId}::uuid AND p."companyId"=${f.companyId}::uuid AND p."branchId"=${f.branchId}::uuid
 ${id?Prisma.sql`AND p.id=${id}::uuid`:Prisma.empty}
 ${f.state==='ALL'?Prisma.empty:Prisma.sql`AND p.archived=${f.state==='ARCHIVED'}`}
 ${f.q?Prisma.sql`AND (position(lower(${f.q}) in lower(p."itemName"))>0 OR position(lower(${f.q}) in lower(p."itemSku"))>0 OR position(lower(${f.q}) in lower(p.reference))>0)`:Prisma.empty}
 ), filtered AS (SELECT * FROM selected WHERE ${f.belowOnly}<>'1' OR status='BELOW_MINIMUM' ORDER BY "updatedAt" DESC,id ASC LIMIT ${cap} OFFSET ${offset}), shaped AS (
 SELECT (to_jsonb(s)-'physical'-'reserved') || jsonb_build_object(
 'minimumQuantity',s."minimumQuantity"::text,'targetQuantity',s."targetQuantity"::text,
 'physicalQuantity',CASE WHEN status IN ('BELOW_MINIMUM','AT_OR_ABOVE_MINIMUM') THEN physical::text ELSE NULL END,
 'reservedQuantity',CASE WHEN status IN ('BELOW_MINIMUM','AT_OR_ABOVE_MINIMUM') THEN reserved::text ELSE NULL END,
 'availableQuantity',CASE WHEN status IN ('BELOW_MINIMUM','AT_OR_ABOVE_MINIMUM') THEN (physical-reserved)::text ELSE NULL END,
 'quantityToTarget',CASE WHEN status IN ('BELOW_MINIMUM','AT_OR_ABOVE_MINIMUM') THEN GREATEST(s."targetQuantity"-(physical-reserved),0.000)::text ELSE NULL END) AS value,
 s."updatedAt",s.id FROM filtered s
 ) SELECT statement_timestamp() AS "observedAt",COALESCE(jsonb_agg(value ORDER BY "updatedAt" DESC,id ASC),'[]'::jsonb) AS policies FROM shaped`);
 const result=rows[0];
 const policies=result.policies.map(raw=>{const p=raw as Record<string,unknown>;return reorderPolicy.parse({...p,createdAt:new Date(p.createdAt as string).toISOString(),updatedAt:new Date(p.updatedAt as string).toISOString()});});
 return {observedAt:result.observedAt.toISOString(),policies};
}
export async function listReorders(actorId:string,f:z.infer<typeof reorderFilters>){return db.$transaction(async tx=>{
 const access=await authorizeRead(tx,actorId,f),result=await observe(tx,f);
 if(f.format==='csv'&&result.policies.length>5000)throw new ReorderError('Export exceeds 5000 policies. Narrow the filters.',413);
 return {...result,policies:result.policies.slice(0,f.format==='csv'?5000:50),page:f.page,nextPage:f.format==='json'&&result.policies.length>50?f.page+1:null,canManage:access.canManage(f)};
 },options);}
export async function readReorder(actorId:string,id:string,inputScope:Scope,page=0){const scope={tenantId:inputScope.tenantId,companyId:inputScope.companyId,branchId:inputScope.branchId};return db.$transaction(async tx=>{
 const access=await authorizeRead(tx,actorId,scope);
 await tx.$queryRaw`SELECT id FROM "InventoryReorderPolicy" WHERE id=${id}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid AND "branchId"=${scope.branchId}::uuid FOR SHARE`;
 const result=await observe(tx,{...scope,state:'ALL',page:0,format:'json',belowOnly:'0'},id);
 const policy=result.policies[0];if(!policy)throw new ReorderError('Reorder policy not found',404);
 const events=await tx.inventoryReorderRevision.findMany({where:{policyId:id,...scope},orderBy:{version:'desc'},skip:page*50,take:51});
 return {policy,events:events.slice(0,50).map(e=>reorderEvent.parse({...e,minimumQuantity:e.minimumQuantity.toFixed(3),targetQuantity:e.targetQuantity.toFixed(3),createdAt:e.createdAt.toISOString()})),page,nextPage:events.length>50?page+1:null,canManage:access.canManage(scope),observedAt:result.observedAt};
 },options);}
export async function listReorderItems(actorId:string,f:z.infer<typeof reorderItemFilters>){return db.$transaction(async tx=>{
 await authorizeRead(tx,actorId,f);
 const rows=await tx.inventoryItem.findMany({where:{tenantId:f.tenantId,companyId:f.companyId,archivedAt:null,AND:[{OR:[{branchId:null},{branchId:f.branchId}]},...(f.q?[{OR:[{name:{contains:f.q,mode:'insensitive' as const}},{sku:{contains:f.q,mode:'insensitive' as const}}]}]:[])]},select:{id:true,sku:true,name:true,unit:true,reorderUnitVersion:true},orderBy:[{name:'asc'},{id:'asc'}],skip:f.page*50,take:51});
 return {items:rows.slice(0,50).map(({reorderUnitVersion,...item})=>({...item,unitVersion:reorderUnitVersion})),page:f.page,nextPage:rows.length>50?f.page+1:null};
 },options);}
