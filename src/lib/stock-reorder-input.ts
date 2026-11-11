import {z} from 'zod';
export const REORDER_REQUEST_MAX_BYTES=12000;
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const wellFormed=(v:string)=>!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const text=(max:number)=>z.string().refine(v=>wellFormed(v)&&Array.from(v).length<=max&&v.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(v));
export const reorderQuantity=z.string().regex(/^(?:0|[1-9]\d{0,14})\.\d{3}$/);
const signedQuantity=z.string().regex(/^-?(?:0|[1-9]\d{0,15})\.\d{3}$/).refine(v=>v!=='-0.000');
export const quantityMilli=(v:string)=>BigInt(v.replace('.',''));
export const reorderScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid});
const identity={itemId:uuid,unit:z.string().refine(v=>wellFormed(v)&&Array.from(v).length<=16&&!v.includes('\u0000')),unitVersion:z.number().int().min(0).max(2147483647)};
const common=reorderScope.extend({expectedActorId:uuid,requestId:uuid,policyId:uuid,...identity,reason:text(300)});
const thresholds={minimumQuantity:reorderQuantity,targetQuantity:reorderQuantity};
export const reorderRequest=z.discriminatedUnion('action',[
 common.extend({action:z.literal('create'),expectedVersion:z.literal(0),...thresholds}).strict(),
 common.extend({action:z.literal('edit'),expectedVersion:z.number().int().min(1).max(2147483646),...thresholds}).strict(),
 common.extend({action:z.literal('archive'),expectedVersion:z.number().int().min(1).max(2147483646)}).strict(),
 common.extend({action:z.literal('restore'),expectedVersion:z.number().int().min(1).max(2147483646)}).strict(),
]).refine(p=>p.requestId!==p.policyId).refine(p=>!('minimumQuantity'in p)||(reorderQuantity.safeParse(p.targetQuantity).success&&reorderQuantity.safeParse(p.minimumQuantity).success&&quantityMilli(p.targetQuantity)>=quantityMilli(p.minimumQuantity)));
export type ReorderRequest=z.infer<typeof reorderRequest>;
export const canonicalReorderRequest=(raw:ReorderRequest)=>reorderRequest.parse(raw);
const snapshot={...identity,itemBranchId:uuid.nullable(),itemName:z.string(),itemSku:z.string(),reference:z.string(),...thresholds,version:z.number().int().positive(),archived:z.boolean(),createdBy:uuid,createdAt:z.string().datetime()};
export const reorderEvent=reorderScope.extend({id:uuid,requestId:uuid,policyId:uuid,...snapshot,action:z.enum(['create','edit','archive','restore']),reason:text(300)}).strict().refine(e=>e.reference===`REO-${e.policyId}`&&(e.itemBranchId===null||e.itemBranchId===e.branchId)&&(reorderQuantity.safeParse(e.targetQuantity).success&&reorderQuantity.safeParse(e.minimumQuantity).success&&quantityMilli(e.targetQuantity)>=quantityMilli(e.minimumQuantity))&&e.archived===(e.action==='archive'));
export type ReorderEvent=z.infer<typeof reorderEvent>;
export function reorderResponseMatches(p:ReorderRequest,raw:unknown){const r=reorderEvent.safeParse(raw);if(!r.success)return false;const e=r.data;return e.id!==e.requestId&&e.id!==e.policyId&&e.requestId===p.requestId&&e.policyId===p.policyId&&e.tenantId===p.tenantId&&e.companyId===p.companyId&&e.branchId===p.branchId&&e.itemId===p.itemId&&e.unit===p.unit&&e.unitVersion===p.unitVersion&&e.reference===`REO-${p.policyId}`&&e.createdBy===p.expectedActorId&&e.version===p.expectedVersion+1&&e.action===p.action&&e.reason===p.reason&&e.archived===(p.action==='archive')&&(!('minimumQuantity'in p)||(e.minimumQuantity===p.minimumQuantity&&e.targetQuantity===p.targetQuantity));}
export const reorderCancellation=reorderScope.extend({id:uuid,policyId:uuid,itemId:uuid,createdBy:uuid,createdAt:z.string().datetime(),request:reorderRequest}).strict();
export function reorderCancellationMatches(p:ReorderRequest,raw:unknown){const r=reorderCancellation.safeParse(raw);return r.success&&r.data.id===p.requestId&&r.data.policyId===p.policyId&&r.data.itemId===p.itemId&&r.data.tenantId===p.tenantId&&r.data.companyId===p.companyId&&r.data.branchId===p.branchId&&r.data.createdBy===p.expectedActorId&&JSON.stringify(canonicalReorderRequest(r.data.request))===JSON.stringify(canonicalReorderRequest(p));}
export function pendingReorder(raw:unknown,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null}){const r=z.object({version:z.literal(1),actorId:uuid,request:reorderRequest}).strict().safeParse(raw);if(!r.success)return null;const p=r.data.request;return r.data.actorId===actorId&&p.expectedActorId===actorId&&p.tenantId===scope.tenantId&&p.companyId===scope.companyId&&p.branchId===scope.branchId?p:null;}
const readScope=reorderScope.extend({expectedActorId:uuid.optional()});
const page=z.coerce.number().int().min(0).max(100000).default(0),q=z.string().refine(v=>wellFormed(v)&&Array.from(v).length<=120&&!/[\u0000]/u.test(v)).optional();
export const reorderFilters=readScope.extend({state:z.enum(['ACTIVE','ARCHIVED','ALL']).default('ACTIVE'),q,page,format:z.enum(['json','csv']).default('json'),belowOnly:z.enum(['0','1']).default('0')}).strict();
export const reorderItemFilters=readScope.extend({q,page}).strict();
export const reorderDetailFilters=readScope.extend({page}).strict();
export const reorderPolicy=reorderScope.extend({id:uuid,...snapshot,updatedAt:z.string().datetime(),status:z.enum(['BELOW_MINIMUM','AT_OR_ABOVE_MINIMUM','ARCHIVED','SOURCE_UNAVAILABLE','UNIT_REVIEW']),physicalQuantity:reorderQuantity.nullable(),reservedQuantity:reorderQuantity.nullable(),availableQuantity:signedQuantity.nullable(),quantityToTarget:signedQuantity.nullable()}).strict().superRefine((p,ctx)=>{
 if(!reorderQuantity.safeParse(p.minimumQuantity).success||!reorderQuantity.safeParse(p.targetQuantity).success)return;
 if(p.reference!==`REO-${p.id}`||(p.itemBranchId!==null&&p.itemBranchId!==p.branchId)||quantityMilli(p.targetQuantity)<quantityMilli(p.minimumQuantity)||(p.status==='ARCHIVED')!==p.archived)ctx.addIssue({code:'custom',message:'Invalid policy identity or thresholds'});
 const available=p.status==='BELOW_MINIMUM'||p.status==='AT_OR_ABOVE_MINIMUM';
 if(!available){if([p.physicalQuantity,p.reservedQuantity,p.availableQuantity,p.quantityToTarget].some(v=>v!==null))ctx.addIssue({code:'custom',message:'Unavailable policy must not have calculations'});return;}
 if(p.physicalQuantity===null||p.reservedQuantity===null||p.availableQuantity===null||p.quantityToTarget===null){ctx.addIssue({code:'custom',message:'Available policy requires calculations'});return;}
 if(!reorderQuantity.safeParse(p.physicalQuantity).success||!reorderQuantity.safeParse(p.reservedQuantity).success||!signedQuantity.safeParse(p.availableQuantity).success||!signedQuantity.safeParse(p.quantityToTarget).success)return;
 const a=quantityMilli(p.physicalQuantity)-quantityMilli(p.reservedQuantity),gap=quantityMilli(p.targetQuantity)-a;
 if(quantityMilli(p.availableQuantity)!==a||quantityMilli(p.quantityToTarget)!==(gap>BigInt(0)?gap:BigInt(0))||(p.status==='BELOW_MINIMUM')!==(a<quantityMilli(p.minimumQuantity)))ctx.addIssue({code:'custom',message:'Invalid current quantities'});
});
const paging={page:z.number().int().nonnegative(),nextPage:z.number().int().positive().nullable()};
export const reorderListResponse=z.object({actorId:uuid,policies:z.array(reorderPolicy).max(50),...paging,canManage:z.boolean(),observedAt:z.string().datetime()}).strict();
export const reorderItemsResponse=z.object({actorId:uuid,items:z.array(z.object({id:uuid,sku:z.string(),name:z.string(),unit:identity.unit,unitVersion:identity.unitVersion}).strict()).max(50),...paging}).strict();
export const reorderDetailResponse=z.object({actorId:uuid,policy:reorderPolicy,events:z.array(reorderEvent).max(50),...paging,canManage:z.boolean(),observedAt:z.string().datetime()}).strict();
