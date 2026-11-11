import {z} from 'zod';
export const RFQ_REQUEST_MAX_BYTES=120000;
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const wellFormed=(v:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const text=(max:number,min=1)=>z.string().refine(v=>wellFormed(v)&&Array.from(v).length<=max&&Array.from(v.trim()).length>=min&&!/[\u0000-\u001f\u007f]/u.test(v));
const notes=z.string().refine(v=>wellFormed(v)&&Array.from(v).length<=2000&&!v.includes('\u0000'));
export const rfqCalendarDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>v.slice(0,4)!=='0000'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const rfqPrice=z.string().regex(/^(?:0|[1-9]\d{0,8})\.\d{3}$/);
const total=z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{3}$/);
export const rfqMilli=(v:string)=>BigInt(v.replace('.',''));
export const rfqMoney=(v:bigint)=>`${v/BigInt(1000)}.${(v%BigInt(1000)).toString().padStart(3,'0')}`;
export const rfqScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.nullable()});
const line=z.object({position:z.number().int().min(0).max(49),description:text(300,2).refine(v=>v===v.trim()),quantity:z.number().int().min(1).max(100000)}).strict();
const lines=z.array(line).min(1).max(50).refine(v=>v.every((l,i)=>l.position===i));
const offerLine=z.object({position:z.number().int().min(0).max(49),unitPrice:rfqPrice}).strict();
const offerLines=z.array(offerLine).max(50).refine(v=>new Set(v.map(l=>l.position)).size===v.length&&v.every((l,i)=>i===0||v[i-1].position<l.position));
const version=z.number().int().min(1).max(2147483646),currency=z.string().regex(/^[A-Z]{3}$/);
const common=rfqScope.extend({expectedActorId:uuid,requestId:uuid,rfqId:uuid,expectedVersion:z.number().int().min(0).max(2147483646),reason:text(300)});
const fields={title:text(200),deadline:rfqCalendarDate.nullable(),notes,lines};
export const rfqRequest=z.discriminatedUnion('action',[
 common.extend({action:z.literal('create'),expectedVersion:z.literal(0),...fields}).strict(),
 common.extend({action:z.literal('edit'),expectedVersion:version,...fields}).strict(),
 common.extend({action:z.literal('open'),expectedVersion:version}).strict(),
 common.extend({action:z.literal('cancel'),expectedVersion:version}).strict(),
 common.extend({action:z.literal('offer'),expectedVersion:version,offerId:uuid,expectedOfferVersion:z.number().int().min(0).max(2147483646),supplierId:uuid,requestRevision:version,currency,validUntil:rfqCalendarDate.nullable(),notes,lines:offerLines}).strict(),
 common.extend({action:z.literal('award'),expectedVersion:version,offerId:uuid,expectedOfferVersion:version,requestRevision:version,purchaseOrderId:uuid,purchaseOrderNumber:z.string().regex(/^[A-Z0-9-]{2,30}$/),evaluationDate:rfqCalendarDate}).strict(),
]).refine(p=>new Set([p.requestId,p.rfqId,...('offerId'in p?[p.offerId]:[]),...('purchaseOrderId'in p?[p.purchaseOrderId]:[])]).size===2+('offerId'in p?1:0)+('purchaseOrderId'in p?1:0)).refine(p=>new TextEncoder().encode(JSON.stringify(p)).length<=RFQ_REQUEST_MAX_BYTES);
export type RfqRequest=z.infer<typeof rfqRequest>;
export const canonicalRfqRequest=(p:RfqRequest)=>rfqRequest.parse(p);
const stamp=z.string().datetime(),positive=z.number().int().positive();
export const rfqSnapshot=rfqScope.extend({id:uuid,...fields,currency,version:positive,requestRevision:positive,status:z.enum(['DRAFT','OPEN','AWARDED','CANCELLED']),createdBy:uuid,createdAt:stamp,updatedAt:stamp,purchaseOrderId:uuid.nullable()}).strict();
export const rfqOffer=rfqScope.extend({id:uuid,rfqId:uuid,supplierId:uuid,supplierBranchId:uuid.nullable(),supplierName:z.string(),supplierCode:z.string(),version:positive,requestRevision:positive,currency,validUntil:rfqCalendarDate.nullable(),notes,lines:offerLines,createdBy:uuid,createdAt:stamp,updatedAt:stamp}).strict();
export const rfqPurchaseOrder=rfqScope.extend({id:uuid,supplierId:uuid,supplierName:z.string(),number:z.string(),currency,subtotal:total,notes:z.string().nullable(),status:z.literal('DRAFT'),createdBy:uuid,createdAt:stamp,lines:z.array(line.extend({id:uuid,unitPrice:rfqPrice,amount:total}).strict()).min(1).max(50)}).strict();
export const rfqEvent=rfqScope.extend({id:uuid,requestId:uuid,rfqId:uuid,version:positive,action:z.enum(['create','edit','open','cancel','offer','award']),createdBy:uuid,createdAt:stamp,request:rfqRequest,rfq:rfqSnapshot,offer:rfqOffer.nullable(),purchaseOrder:rfqPurchaseOrder.nullable()}).strict();
export type RfqEvent=z.infer<typeof rfqEvent>;
export function rfqResponseMatches(p:RfqRequest,raw:unknown){const r=rfqEvent.safeParse(raw);if(!r.success)return false;const e=r.data,d=e.rfq;if(JSON.stringify(canonicalRfqRequest(e.request))!==JSON.stringify(canonicalRfqRequest(p))||e.id===p.requestId||e.id===p.rfqId||e.requestId!==p.requestId||e.rfqId!==p.rfqId||e.createdBy!==p.expectedActorId||e.version!==p.expectedVersion+1||e.action!==p.action||e.tenantId!==p.tenantId||e.companyId!==p.companyId||e.branchId!==p.branchId||d.id!==p.rfqId||d.tenantId!==p.tenantId||d.companyId!==p.companyId||d.branchId!==p.branchId||d.version!==e.version)return false;
 if(d.updatedAt!==e.createdAt||d.requestRevision>d.version||d.status!=='AWARDED'&&d.purchaseOrderId!==null||p.action==='create'&&(d.createdBy!==p.expectedActorId||d.createdAt!==e.createdAt||d.requestRevision!==1))return false;
 if((p.action==='award')!==(e.purchaseOrder!==null)||(['offer','award'].includes(p.action))!==(e.offer!==null))return false;
 if(p.action==='create'||p.action==='edit'){if(d.status!=='DRAFT'||d.title!==p.title||d.deadline!==p.deadline||d.notes!==p.notes||JSON.stringify(d.lines)!==JSON.stringify(p.lines))return false;}
 if(p.action==='open'&&d.status!=='OPEN'||p.action==='cancel'&&d.status!=='CANCELLED')return false;
 if(p.action==='offer'||p.action==='award'){const o=e.offer!;if(o.id!==p.offerId||o.rfqId!==p.rfqId||o.tenantId!==p.tenantId||o.companyId!==p.companyId||o.branchId!==p.branchId||o.requestRevision!==p.requestRevision||d.requestRevision!==p.requestRevision||o.version!==p.expectedOfferVersion+(p.action==='offer'?1:0))return false;
 if(o.supplierBranchId!==null&&o.supplierBranchId!==p.branchId||o.lines.some(l=>!d.lines.some(x=>x.position===l.position)))return false;
 if(p.action==='offer'&&(o.updatedAt!==e.createdAt||p.expectedOfferVersion===0&&(o.createdBy!==p.expectedActorId||o.createdAt!==e.createdAt)))return false;
 if(p.action==='offer'&&(o.supplierId!==p.supplierId||o.currency!==p.currency||o.validUntil!==p.validUntil||o.notes!==p.notes||JSON.stringify(o.lines)!==JSON.stringify(p.lines)||d.status!=='OPEN'))return false;
 if(p.action==='award'){const po=e.purchaseOrder!;if(d.status!=='AWARDED'||d.purchaseOrderId!==p.purchaseOrderId||po.id!==p.purchaseOrderId||po.number!==p.purchaseOrderNumber||po.tenantId!==p.tenantId||po.companyId!==p.companyId||po.branchId!==p.branchId||po.supplierId!==o.supplierId||po.supplierName!==o.supplierName||po.createdAt!==e.createdAt||o.lines.length!==d.lines.length||po.currency!==d.currency||o.currency!==d.currency||po.createdBy!==p.expectedActorId||po.lines.length!==d.lines.length)return false;let sum=BigInt(0);for(const [i,l]of po.lines.entries()){const source=d.lines[i],price=o.lines.find(x=>x.position===i);if(!price||l.position!==i||l.description!==source.description||l.quantity!==source.quantity||l.unitPrice!==price.unitPrice||rfqMilli(l.amount)!==rfqMilli(l.unitPrice)*BigInt(l.quantity))return false;sum+=rfqMilli(l.amount);}if(rfqMilli(po.subtotal)!==sum)return false;}}
 return true;}
export const rfqCancellation=rfqScope.extend({id:uuid,rfqId:uuid,createdBy:uuid,createdAt:stamp,request:rfqRequest}).strict();
export function rfqCancellationMatches(p:RfqRequest,raw:unknown){const r=rfqCancellation.safeParse(raw);return r.success&&r.data.id===p.requestId&&r.data.rfqId===p.rfqId&&r.data.tenantId===p.tenantId&&r.data.companyId===p.companyId&&r.data.branchId===p.branchId&&r.data.createdBy===p.expectedActorId&&JSON.stringify(canonicalRfqRequest(r.data.request))===JSON.stringify(canonicalRfqRequest(p));}
export function pendingRfq(raw:unknown,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null}){const r=z.object({version:z.literal(1),actorId:uuid,request:rfqRequest}).strict().safeParse(raw);if(!r.success)return null;const p=r.data.request;return r.data.actorId===actorId&&p.expectedActorId===actorId&&p.tenantId===scope.tenantId&&p.companyId===scope.companyId&&p.branchId===scope.branchId?p:null;}
const readScope=z.object({tenantId:uuid,companyId:uuid,branchId:z.union([uuid,z.literal('company')]),expectedActorId:uuid.optional()});
const page=z.coerce.number().int().min(0).max(100000).default(0);
export const rfqFilters=readScope.extend({page,state:z.enum(['ALL','DRAFT','OPEN','AWARDED','CANCELLED']).default('ALL')}).strict();
export const rfqDetailFilters=readScope.extend({page}).strict();
export const rfqOfferFilters=readScope.extend({page,evaluationDate:rfqCalendarDate}).strict();
export const rfqSupplierFilters=readScope.extend({page,q:text(120).optional()}).strict();
export const rfqExportFilters=readScope.extend({eventId:uuid}).strict();
const paging={page:z.number().int().nonnegative(),nextPage:z.number().int().positive().nullable()},rights={canManage:z.boolean(),canAward:z.boolean()},observation={actorId:uuid,observedAt:stamp};
export const rfqListResponse=z.object({...observation,rfqs:z.array(rfqSnapshot).max(50),...paging,...rights}).strict();
export const rfqDetailResponse=z.object({...observation,rfq:rfqSnapshot,events:z.array(rfqEvent).max(50),...paging,...rights}).strict();
export const rfqComparisonOffer=rfqOffer.extend({status:z.enum(['CURRENT','STALE_REQUEST','EXPIRED','INCOMPLETE','CURRENCY_MISMATCH','SOURCE_UNAVAILABLE','TOTAL_OVERFLOW']),complete:z.boolean(),total:total.nullable(),canAward:z.boolean(),validityKnown:z.boolean()}).strict();
export const rfqOffersResponse=z.object({...observation,rfqVersion:positive,requestRevision:positive,asOf:rfqCalendarDate,offers:z.array(rfqComparisonOffer).max(50),...paging,totalOffers:z.number().int().nonnegative(),comparisonComplete:z.boolean()}).strict();
export const rfqSuppliersResponse=z.object({actorId:uuid,suppliers:z.array(z.object({id:uuid,displayName:z.string(),code:z.string(),branchId:uuid.nullable()}).strict()).max(50),...paging}).strict();
