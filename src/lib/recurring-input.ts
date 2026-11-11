import {z} from 'zod';
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const text=(max:number)=>z.string().min(1).refine(v=>Array.from(v).length<=max&&v.trim().length>0&&!/[\u0000-\u001f\u007f]/u.test(v)&&!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v));
export const recurringDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>v>='2000-01-01'&&v<='2099-12-31'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
export const recurringCadence=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('MONTHLY'),months:z.number().int().min(1).max(120),rule:z.enum(['CLAMP_ORIGINAL_DAY','MONTH_END'])}).strict(),
 z.object({kind:z.literal('ANNUAL'),years:z.number().int().min(1).max(10),leapDay:z.enum(['FEBRUARY_28','MARCH_1'])}).strict(),
 z.object({kind:z.literal('DAYS'),days:z.number().int().min(1).max(3660)}).strict(),
]);
export const recurringTerms=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('NONE')}).strict(),
 z.object({kind:z.literal('OFFSET'),label:text(120).refine(v=>v.trim().length>=3),days:z.number().int().min(0).max(3650),base:z.enum(['PERIOD_START','PERIOD_END'])}).strict(),
]);
export const recurringLines=z.array(z.object({description:text(2000),quantity:z.number().int().min(1).max(2147483647),unitPrice:z.string().regex(/^(0|[1-9]\d{0,14})\.\d{3}$/),treatment:z.enum(['STANDARD','ZERO','EXEMPT'])}).strict()).min(1).max(500);
export const recurringScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.nullable()});
const common=recurringScope.extend({expectedActorId:uuid,requestId:uuid,reason:text(300)});
export const recurringPlanRequest=common.extend({action:z.literal('plan'),planId:uuid,expectedVersion:z.number().int().min(0).max(2147483646),label:text(200),currency:z.string().regex(/^[A-Z]{3}$/),lines:recurringLines,archived:z.boolean()}).strict();
export const recurringSubscriptionRequest=common.extend({action:z.literal('configure'),subscriptionId:uuid,customerId:uuid,manualSubscriptionId:uuid.nullable(),expectedVersion:z.number().int().min(0).max(2147483646),anchor:recurringDate,cadence:recurringCadence,effectivePeriod:z.number().int().min(0).max(100000),planId:uuid,planVersion:z.number().int().min(1).max(2147483647),horizon:recurringDate,status:z.enum(['ACTIVE','PAUSED','ENDED']),terms:recurringTerms,archived:z.boolean()}).strict().refine(p=>p.horizon>p.anchor);
export const recurringGenerateRequest=common.extend({action:z.enum(['generate','backfill','replace']),subscriptionId:uuid,expectedVersion:z.number().int().min(1),periodIndex:z.number().int().min(0).max(100000),previewHash:z.string().regex(/^[a-f0-9]{64}$/),replacesSourceId:uuid.nullable(),replacementPlanRevisionId:uuid.nullable()}).strict().refine(p=>(p.action==='replace')===(p.replacesSourceId!==null)&&(p.action==='replace')===(p.replacementPlanRevisionId!==null));
export const recurringRequest=z.union([recurringPlanRequest,recurringSubscriptionRequest,recurringGenerateRequest]).refine(p=>p.requestId!==(p.action==='plan'?p.planId:p.subscriptionId));
export type RecurringRequest=z.infer<typeof recurringRequest>;
export type RecurringPlanRequest=z.infer<typeof recurringPlanRequest>;
export type RecurringSubscriptionRequest=z.infer<typeof recurringSubscriptionRequest>;
export type RecurringGenerateRequest=z.infer<typeof recurringGenerateRequest>;
export const canonicalRecurringRequest=(raw:RecurringRequest)=>recurringRequest.parse(raw);
export const recurringFilters=z.object({tenantId:uuid,companyId:uuid,branchId:z.union([uuid,z.literal('company')]).optional(),expectedActorId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export const recurringPreviewRequest=recurringScope.extend({expectedActorId:uuid,subscriptionId:uuid,offset:z.number().int().min(0).max(100000),limit:z.number().int().min(1).max(50),backfill:z.boolean(),replacesSourceId:uuid.nullable(),replacementPlanRevisionId:uuid.nullable()}).strict().refine(p=>(p.replacesSourceId===null)===(p.replacementPlanRevisionId===null));
export function pendingRecurringRequest(raw:unknown,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null}){
 const r=z.object({version:z.literal(1),actorId:uuid,request:recurringRequest}).strict().safeParse(raw);if(!r.success)return null;
 const p=r.data.request;return r.data.actorId===actorId&&p.expectedActorId===actorId&&p.tenantId===scope.tenantId&&p.companyId===scope.companyId&&p.branchId===scope.branchId?p:null;
}
export const recurringHistoryFilters=z.object({tenantId:uuid,companyId:uuid,branchId:z.union([uuid,z.literal('company')]),expectedActorId:uuid,kind:z.enum(['plan','subscription']),id:uuid,page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
