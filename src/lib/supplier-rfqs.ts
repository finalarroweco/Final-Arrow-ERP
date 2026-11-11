import {Prisma,type SupplierRfqRequest} from '@prisma/client';
import {z} from 'zod';
import {db} from './db';
import {loadRfqAccess} from './supplier-rfq-access';
import {canonicalRfqRequest,rfqResponseMatches,rfqCancellationMatches,rfqEvent,rfqSnapshot,rfqOffer,rfqMilli,rfqMoney,rfqFilters,rfqOfferFilters,rfqSupplierFilters,type RfqRequest} from './supplier-rfq-input';
export class RfqError extends Error{constructor(message:string,public status=409){super(message);}}
const options={timeout:20000,maxWait:10000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted};
type Scope={tenantId:string;companyId:string;branchId:string|null};
type QueryScope={tenantId:string;companyId:string;branchId:string};
const scopeOf=(q:QueryScope):Scope=>({tenantId:q.tenantId,companyId:q.companyId,branchId:q.branchId==='company'?null:q.branchId});
async function tenantLock(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;}
function cancellation(row:SupplierRfqRequest){return {id:row.id,tenantId:row.tenantId,companyId:row.companyId,branchId:row.branchId,rfqId:row.rfqId,createdBy:row.createdBy,createdAt:row.createdAt.toISOString(),request:row.request};}
function savedResult(row:SupplierRfqRequest,input:RfqRequest){if(JSON.stringify(canonicalRfqRequest(input))!==JSON.stringify(canonicalRfqRequest(row.request as RfqRequest))||row.createdBy!==input.expectedActorId)throw new RfqError('Request identity belongs to different details');if(row.outcome==='ABANDONED'){const c=cancellation(row);if(!rfqCancellationMatches(input,c))throw new RfqError('Invalid saved cancellation');return {cancellation:c};}const event=rfqEvent.parse(row.result);if(!rfqResponseMatches(input,event))throw new RfqError('Invalid saved RFQ receipt');return {event};}
export async function mutateRfq(actorId:string,input:RfqRequest,abandon=false){return db.$transaction(async tx=>{
 await tenantLock(tx,input.tenantId);if(input.expectedActorId!==actorId)throw new RfqError('Saved request belongs to a different signed-in user',403);
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'supplier-rfq-request:'+input.requestId},0))`;
 await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${'supplier-rfq:'+input.rfqId},0))`;
 const access=await loadRfqAccess(tx,actorId,input.tenantId);if(!access.canManage(input)||input.action==='award'&&!access.canAward(input))throw new RfqError('Current RFQ and purchase-order access required',403);
 const saved=await tx.supplierRfqRequest.findUnique({where:{id:input.requestId}});
 // Tombstones contain only supplied identities: disappearance or movement must not prevent fencing a delayed send.
 const sourceRequired=saved?saved.outcome==='COMMITTED':!abandon;
 if(sourceRequired&&(input.action==='offer'||input.action==='award')){
  const supplierId=input.action==='offer'?input.supplierId:(await tx.supplierOffer.findFirst({where:{id:input.offerId,rfqId:input.rfqId,tenantId:input.tenantId,companyId:input.companyId,branchId:input.branchId},select:{supplierId:true}}))?.supplierId;
  if(!supplierId)throw new RfqError('Offer source not found',404);
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id=${supplierId}::uuid FOR SHARE`;
  const supplier=await tx.supplier.findFirst({where:{id:supplierId,tenantId:input.tenantId,companyId:input.companyId},select:{companyId:true,branchId:true}});
  if(!supplier||!access.canReadSupplier(supplier)||supplier.branchId!==null&&supplier.branchId!==input.branchId)throw new RfqError('Current supplier source access required',403);
 }
 if(saved){const result=savedResult(saved,input);if(!abandon&&'cancellation'in result)throw new RfqError('Request was permanently abandoned. Prepare a new request.');return result;}
 const row=await tx.supplierRfqRequest.create({data:{id:input.requestId,rfqId:input.rfqId,tenantId:input.tenantId,companyId:input.companyId,branchId:input.branchId,createdBy:actorId,action:input.action,expectedVersion:input.expectedVersion,request:canonicalRfqRequest(input),outcome:abandon?'ABANDONED':'COMMITTED'}});return savedResult(row,input);
 },options);}
const stamp=(v:Date)=>v.toISOString();
function rfqView(row:Record<string,unknown>){return rfqSnapshot.parse({...row,deadline:row.deadline instanceof Date?row.deadline.toISOString().slice(0,10):row.deadline,createdAt:new Date(row.createdAt as string|Date).toISOString(),updatedAt:new Date(row.updatedAt as string|Date).toISOString()});}
function offerView(row:Record<string,unknown>){return rfqOffer.parse({...row,validUntil:row.validUntil instanceof Date?row.validUntil.toISOString().slice(0,10):row.validUntil,createdAt:new Date(row.createdAt as string|Date).toISOString(),updatedAt:new Date(row.updatedAt as string|Date).toISOString()});}
async function authorizeRead(tx:Prisma.TransactionClient,actorId:string,scope:Scope){await tenantLock(tx,scope.tenantId);const access=await loadRfqAccess(tx,actorId,scope.tenantId);if(!access.canRead(scope))throw new RfqError('Current RFQ scope access required',403);if(!await tx.company.findFirst({where:{id:scope.companyId,tenantId:scope.tenantId},select:{id:true}})||scope.branchId&&!await tx.branch.findFirst({where:{id:scope.branchId,tenantId:scope.tenantId,companyId:scope.companyId},select:{id:true}}))throw new RfqError('Scope not found',404);return access;}
async function lockRfq(tx:Prisma.TransactionClient,id:string,scope:Scope){await tx.$queryRaw`SELECT id FROM "SupplierRfq" WHERE id=${id}::uuid AND "tenantId"=${scope.tenantId}::uuid AND "companyId"=${scope.companyId}::uuid AND "branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid FOR SHARE`;const row=await tx.supplierRfq.findFirst({where:{id,...scope}});if(!row)throw new RfqError('RFQ not found',404);return row;}
function visibleRfq(row:Record<string,unknown>,canReadPo:boolean){return rfqView({...row,...(canReadPo?{}:{purchaseOrderId:null})});}
export async function listRfqs(actorId:string,f:z.infer<typeof rfqFilters>){return db.$transaction(async tx=>{const scope=scopeOf(f),access=await authorizeRead(tx,actorId,scope);const rows=await tx.supplierRfq.findMany({where:{...scope,...(f.state==='ALL'?{}:{status:f.state})},orderBy:[{updatedAt:'desc'},{id:'asc'}],skip:f.page*50,take:51});return {actorId,rfqs:rows.slice(0,50).map(r=>visibleRfq(r,access.canReadPurchaseOrder(scope))),page:f.page,nextPage:rows.length>50?f.page+1:null,canManage:access.canManage(scope),canAward:access.canAward(scope),observedAt:new Date().toISOString()};},options);}
/** History is filtered by the CURRENT supplier scope, independently of RFQ scope.
 * A revision containing a PO is not disclosed without independent PO read access.
 * Counts and paging describe only authorized records, never hidden offer existence.
 */
export async function readRfq(actorId:string,id:string,f:QueryScope,page=0,eventId?:string){return db.$transaction(async tx=>{
 const scope=scopeOf(f),access=await authorizeRead(tx,actorId,scope),row=await lockRfq(tx,id,scope);
 const events=await tx.$queryRaw<Record<string,unknown>[]>(Prisma.sql`SELECT r.* FROM "SupplierRfqRevision" r WHERE r."rfqId"=${id}::uuid AND r."tenantId"=${scope.tenantId}::uuid AND r."companyId"=${scope.companyId}::uuid AND r."branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid
 AND (r.offer IS NULL OR EXISTS(SELECT 1 FROM "Supplier" s WHERE s.id=(r.offer->>'supplierId')::uuid AND s."tenantId"=r."tenantId" AND s."companyId"=r."companyId" AND erp_payment_term_actor_access(${actorId}::uuid,s."tenantId",s."companyId",s."branchId",'supplier:read')))
 AND (r."purchaseOrder" IS NULL OR ${access.canReadPurchaseOrder(scope)})
 ${eventId?Prisma.sql`AND r.id=${eventId}::uuid`:Prisma.empty} ORDER BY r.version DESC OFFSET ${eventId?0:page*50} LIMIT ${eventId?1:51}`);
 if(eventId&&!events.length)throw new RfqError('Authorized revision not found',404);
 return {actorId,rfq:visibleRfq(row,access.canReadPurchaseOrder(scope)),events:events.slice(0,50).map(e=>rfqEvent.parse({...e,createdAt:e.createdAt instanceof Date?stamp(e.createdAt):e.createdAt})),page:eventId?0:page,nextPage:!eventId&&events.length>50?page+1:null,canManage:access.canManage(scope),canAward:access.canAward(scope),observedAt:new Date().toISOString()};
 },options);}
export async function listRfqOffers(actorId:string,id:string,f:z.infer<typeof rfqOfferFilters>){return db.$transaction(async tx=>{
 const scope=scopeOf(f),access=await authorizeRead(tx,actorId,scope),row=await lockRfq(tx,id,scope),rfq=rfqView(row);
 // One statement observes source eligibility, source permission, authorized count and page.
 const result=await tx.$queryRaw<{offers:Record<string,unknown>[];totalOffers:number;observedAt:Date}[]>(Prisma.sql`WITH visible AS(SELECT o.*,s."archivedAt" AS "sourceArchivedAt",s."branchId" AS "sourceBranchId",s."companyId" AS "sourceCompanyId" FROM "SupplierOffer" o JOIN "Supplier" s ON s.id=o."supplierId" WHERE o."rfqId"=${id}::uuid AND o."tenantId"=${scope.tenantId}::uuid AND o."companyId"=${scope.companyId}::uuid AND o."branchId" IS NOT DISTINCT FROM ${scope.branchId}::uuid AND s."tenantId"=o."tenantId" AND s."companyId"=o."companyId" AND erp_payment_term_actor_access(${actorId}::uuid,s."tenantId",s."companyId",s."branchId",'supplier:read')), paged AS(SELECT * FROM visible ORDER BY "updatedAt" DESC,id ASC OFFSET ${f.page*50} LIMIT 50) SELECT statement_timestamp() AS "observedAt",(SELECT count(*)::integer FROM visible) AS "totalOffers",COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."updatedAt" DESC,p.id) FROM paged p),'[]'::jsonb) AS offers`);
 const currentCompany=await tx.company.findUniqueOrThrow({where:{id:scope.companyId},select:{baseCurrency:true}});
 const observation=result[0],observedAt=observation.observedAt.toISOString(),asOf=f.evaluationDate>observedAt.slice(0,10)?f.evaluationDate:observedAt.slice(0,10);
 const offers=observation.offers.map(raw=>{const {sourceArchivedAt,sourceBranchId,sourceCompanyId,...data}=raw,o=offerView(data),complete=o.lines.length===rfq.lines.length&&rfq.lines.every(l=>o.lines.some(x=>x.position===l.position));let amount=BigInt(0);for(const l of o.lines){const source=rfq.lines.find(x=>x.position===l.position);if(source)amount+=BigInt(source.quantity)*rfqMilli(l.unitPrice);}const current=o.requestRevision===rfq.requestRevision,sameCurrency=o.currency===rfq.currency&&currentCompany.baseCurrency===rfq.currency,sourceAvailable=sourceArchivedAt===null&&sourceCompanyId===scope.companyId&&(sourceBranchId===null||sourceBranchId===scope.branchId),expired=o.validUntil!==null&&o.validUntil<asOf;
 const status=!sourceAvailable?'SOURCE_UNAVAILABLE':!current?'STALE_REQUEST':!sameCurrency?'CURRENCY_MISMATCH':!complete?'INCOMPLETE':expired?'EXPIRED':amount>BigInt('999999999999999999')?'TOTAL_OVERFLOW':'CURRENT';
 return {...o,status,complete,total:current&&sameCurrency&&complete&&amount<=BigInt('999999999999999999')?rfqMoney(amount):null,canAward:access.canAward(scope)&&rfq.status==='OPEN'&&status==='CURRENT'&&amount<=BigInt('999999999999999999'),validityKnown:o.validUntil!==null};});
 return {actorId,rfqVersion:rfq.version,requestRevision:rfq.requestRevision,offers,page:f.page,nextPage:(f.page+1)*50<observation.totalOffers?f.page+1:null,totalOffers:observation.totalOffers,comparisonComplete:f.page===0&&observation.totalOffers<=50,observedAt,asOf};
 },options);}
export async function listRfqSuppliers(actorId:string,f:z.infer<typeof rfqSupplierFilters>){return db.$transaction(async tx=>{const scope=scopeOf(f),access=await authorizeRead(tx,actorId,scope),branches=access.supplierBranches(scope.companyId);const rows=await tx.supplier.findMany({where:{tenantId:scope.tenantId,companyId:scope.companyId,archivedAt:null,AND:[{OR:[{branchId:null},...(scope.branchId?[{branchId:scope.branchId}]:[])]},...(branches===null?[]:[{branchId:{in:branches}}])],...(f.q?{OR:[{displayName:{contains:f.q,mode:'insensitive'}},{code:{contains:f.q,mode:'insensitive'}}]}:{})},select:{id:true,displayName:true,code:true,branchId:true},orderBy:[{displayName:'asc'},{id:'asc'}],skip:f.page*50,take:51});return {actorId,suppliers:rows.slice(0,50),page:f.page,nextPage:rows.length>50?f.page+1:null};},options);}
