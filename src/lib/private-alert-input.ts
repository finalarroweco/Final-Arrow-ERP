import {z} from 'zod';
const uuid=z.string().uuid();
const instant=z.string().datetime({offset:true}).transform(value=>new Date(value).toISOString());
export const alertKind=z.enum(['TICKET_DEADLINE','SUBSCRIPTION_REVIEW','STOCK_REORDER']);
export const alertConfig=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('TICKET_DEADLINE'),branchId:uuid.nullable(),lookbackDays:z.number().int().min(0).max(3660),horizonDays:z.number().int().min(0).max(366),priority:z.enum(['ALL','LOW','NORMAL','HIGH','URGENT'])}).strict(),
 z.object({kind:z.literal('SUBSCRIPTION_REVIEW'),branchId:uuid.nullable(),lookbackDays:z.number().int().min(0).max(3660),horizonDays:z.number().int().min(0).max(366),priority:z.null()}).strict(),
 z.object({kind:z.literal('STOCK_REORDER'),branchId:uuid,lookbackDays:z.null(),horizonDays:z.null(),priority:z.null()}).strict(),
]);
export const alertRequest=z.object({requestId:uuid,tenantId:uuid,companyId:uuid,expectedActorId:uuid,ruleId:uuid,action:z.enum(['create','enable','disable','evaluate','acknowledge']),expectedVersion:z.number().int().min(0).max(2147483646),config:alertConfig.nullable(),noticeId:uuid.nullable()}).strict().superRefine((v,c)=>{
 if(v.requestId===v.ruleId||(v.action==='create')!==(v.expectedVersion===0)||(v.action==='create')!==(v.config!==null)||(v.action==='acknowledge')!==(v.noticeId!==null))c.addIssue({code:'custom',message:'Exact action fields required'});
});
export type AlertRequest=z.infer<typeof alertRequest>;
export const canonicalAlertRequest=(r:AlertRequest)=>({requestId:r.requestId,tenantId:r.tenantId,companyId:r.companyId,expectedActorId:r.expectedActorId,ruleId:r.ruleId,action:r.action,expectedVersion:r.expectedVersion,config:r.config?{kind:r.config.kind,branchId:r.config.branchId,lookbackDays:r.config.lookbackDays,horizonDays:r.config.horizonDays,priority:r.config.priority}:null,noticeId:r.noticeId});
export const alertQuery=z.object({tenantId:uuid,companyId:uuid,expectedActorId:uuid,page:z.string().regex(/^(0|[1-9][0-9]{0,5})$/).transform(Number).default(0),ruleId:uuid.optional(),view:z.enum(['rules','notices']).default('rules'),unread:z.enum(['0','1']).default('0')}).strict();
export const alertRule=z.object({id:uuid,tenantId:uuid,companyId:uuid,branchId:uuid.nullable(),actorId:uuid,kind:alertKind,lookbackDays:z.number().nullable(),horizonDays:z.number().nullable(),priority:z.string().nullable(),enabled:z.boolean(),version:z.number().int().positive(),lastEvaluatedAt:instant.nullable(),createdAt:instant}).strict();
export const alertNotice=z.object({id:uuid,ruleId:uuid,sourceId:uuid,fingerprint:z.string(),episode:z.number().int().positive(),observation:z.record(z.string(),z.unknown()).transform((value,ctx)=>{if(typeof value.dueAt!=='string')return value;const due=instant.safeParse(value.dueAt);if(!due.success){ctx.addIssue({code:'custom',message:'Invalid observed due instant'});return z.NEVER;}return {...value,dueAt:due.data};}),observedAt:instant,lastMatchedAt:instant,lastEvaluationMatched:z.boolean(),acknowledgedAt:instant.nullable(),kind:alertKind,branchId:uuid.nullable()}).strict();
export const alertList=z.object({actorId:uuid,tenantId:uuid,companyId:uuid,page:z.number().int(),nextPage:z.number().int().nullable(),rules:z.array(alertRule),notices:z.array(alertNotice),view:z.enum(['rules','notices']),ruleId:uuid.nullable()}).strict();
export function alertReceiptMatches(input:AlertRequest,value:unknown){const r=z.object({requestId:uuid,ruleId:uuid,actorId:uuid,action:z.string(),version:z.number().int(),outcome:z.enum(['COMMITTED','ABANDONED']),request:alertRequest}).strict().safeParse(value);return r.success&&r.data.requestId===input.requestId&&r.data.ruleId===input.ruleId&&r.data.actorId===input.expectedActorId&&r.data.action===input.action&&r.data.version===input.expectedVersion+1&&JSON.stringify(canonicalAlertRequest(r.data.request))===JSON.stringify(canonicalAlertRequest(input));}

export const ALERT_REQUEST_MAX_BYTES=8192;
export type AlertReceipt={requestId:string;ruleId:string;actorId:string;action:string;version:number;outcome:'COMMITTED'|'ABANDONED';request:AlertRequest};
export function pendingAlert(raw:unknown,actorId:string,scope:{tenantId:string;companyId:string}){const p=z.object({version:z.literal(1),actorId:z.literal(actorId),request:alertRequest}).strict().safeParse(raw);return p.success&&p.data.request.expectedActorId===actorId&&p.data.request.tenantId===scope.tenantId&&p.data.request.companyId===scope.companyId&&new TextEncoder().encode(JSON.stringify(p.data.request)).length<=ALERT_REQUEST_MAX_BYTES?p.data.request:null;}
