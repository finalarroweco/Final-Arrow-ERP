import {z} from 'zod';
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
export const automationScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.nullable(),expectedActorId:uuid});
export const automationConfig=z.object({kind:z.enum(['RECURRING_DRAFT','PRIVATE_ALERT']),sourceId:uuid,firstPeriod:z.number().int().min(0).max(100000).nullable(),lastPeriod:z.number().int().min(0).max(100000).nullable(),startsAt:z.string().datetime(),endsAt:z.string().datetime(),intervalHours:z.number().int().min(1).max(168),maxRuns:z.number().int().min(1).max(100),sourceFingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict().superRefine((p,c)=>{
 if(Date.parse(p.endsAt)<=Date.parse(p.startsAt)||Date.parse(p.endsAt)-Date.parse(p.startsAt)>366*86400000)c.addIssue({code:'custom',message:'Finite horizon of at most 366 days required'});
 if(p.kind==='RECURRING_DRAFT'?(p.firstPeriod===null||p.lastPeriod===null||p.lastPeriod<p.firstPeriod||p.lastPeriod-p.firstPeriod>=24):(p.firstPeriod!==null||p.lastPeriod!==null))c.addIssue({code:'custom',message:'Choose one to 24 explicit periods for draft billing only'});
});
export const automationCommand=automationScope.extend({requestId:uuid,jobId:uuid,action:z.enum(['create','enable','pause','cancel','run']),expectedVersion:z.number().int().min(0).max(2147483646),config:automationConfig.nullable()}).strict().refine(p=>(p.action==='create')===(p.config!==null)&&(p.action==='create')===(p.expectedVersion===0)&&p.requestId!==p.jobId);
export type AutomationCommand=z.infer<typeof automationCommand>;
export type AutomationConfig=z.infer<typeof automationConfig>;
export const automationQuery=automationScope.extend({branchId:z.union([uuid,z.literal('company')]).transform(v=>v==='company'?null:v),page:z.coerce.number().int().min(0).max(10000).default(0),jobId:uuid.optional()}).strict();
export const automationPreview=automationScope.extend({kind:z.enum(['RECURRING_DRAFT','PRIVATE_ALERT']),sourceId:uuid}).strict();
export function pendingAutomation(value:unknown,actorId:string,scope:{tenantId:string;companyId:string;branchId:string|null}){const r=automationCommand.safeParse(value);return r.success&&r.data.expectedActorId===actorId&&r.data.tenantId===scope.tenantId&&r.data.companyId===scope.companyId&&r.data.branchId===scope.branchId?r.data:null;}
export function nextAutomationTick(start:Date,intervalHours:number,now:Date){const step=intervalHours*3600000;return new Date(start.getTime()+Math.max(0,Math.floor((now.getTime()-start.getTime())/step)+1)*step);}
