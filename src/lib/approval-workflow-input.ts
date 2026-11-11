import { z } from 'zod';
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const text=(max:number)=>z.string().trim().min(1).max(max).refine(s=>!/[\u0000-\u001f\u007f]/.test(s),'Control characters are not allowed');
export const approvalResource=z.enum(['PURCHASE','EXPENSE','LEAVE','DOCUMENT']);
export type ApprovalResource=z.infer<typeof approvalResource>;
export const approvalScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.nullable()}).strict();
export const approvalStage=z.object({name:text(120),quorum:z.number().int().min(1).max(50),userIds:z.array(uuid).max(100),roleIds:z.array(uuid).max(50)}).strict().superRefine((s,c)=>{
 if(!s.userIds.length&&!s.roleIds.length)c.addIssue({code:'custom',message:'Choose named users or roles'});
 if(new Set(s.userIds).size!==s.userIds.length||new Set(s.roleIds).size!==s.roleIds.length)c.addIssue({code:'custom',message:'Duplicate eligible approver'});
 if(!s.roleIds.length&&s.quorum>s.userIds.length)c.addIssue({code:'custom',message:'Quorum exceeds named approvers'});
});
const amount=z.string().regex(/^(0|[1-9]\d{0,14})\.\d{3}$/);
export const approvalConfiguration=z.object({title:text(160),enabled:z.boolean(),resource:approvalResource,currency:z.string().regex(/^[A-Z]{3}$/).nullable(),minimumAmount:amount.nullable(),maximumAmount:amount.nullable(),excludeRequester:z.boolean(),stages:z.array(approvalStage).min(1).max(12)}).strict().superRefine((p,c)=>{
 if(['LEAVE','DOCUMENT'].includes(p.resource)&&(p.currency!==null||p.minimumAmount!==null||p.maximumAmount!==null))c.addIssue({code:'custom',message:'This resource has no monetary threshold'});
 if((p.minimumAmount!==null||p.maximumAmount!==null)&&p.currency===null)c.addIssue({code:'custom',message:'Thresholds require an explicit currency'});
 if(p.minimumAmount!==null&&p.maximumAmount!==null&&BigInt(p.minimumAmount.replace('.',''))>BigInt(p.maximumAmount.replace('.','')))c.addIssue({code:'custom',message:'Minimum exceeds maximum'});
});
export const approvalPolicyCommand=approvalScope.extend({requestId:uuid,expectedActorId:uuid,policyId:uuid,expectedVersion:z.number().int().min(0),configuration:approvalConfiguration}).strict();
export const approvalSubmit=approvalScope.extend({requestId:uuid,expectedActorId:uuid,resource:approvalResource,sourceId:uuid,policyId:uuid,policyVersion:z.number().int().min(1),sourceFingerprint:z.string().regex(/^[a-f0-9]{32}$/)}).strict();
export const approvalVote=approvalScope.extend({requestId:uuid,expectedActorId:uuid,approvalId:uuid,expectedVersion:z.number().int().min(1),action:z.enum(['APPROVE','REJECT','CANCEL']),reason:z.string().trim().max(500).refine(s=>!/[\u0000-\u001f\u007f]/.test(s))}).strict().refine(v=>v.action==='APPROVE'||v.reason.length>=3,'Rejection or cancellation requires a reason');
export const approvalFilters=z.object({tenantId:uuid,companyId:uuid,branchId:z.union([uuid,z.literal('company')]),page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export const approvalSourceQuery=approvalFilters.omit({page:true}).extend({resource:approvalResource,sourceId:uuid}).strict();
export type ApprovalPolicyCommand=z.infer<typeof approvalPolicyCommand>;
export type ApprovalSubmit=z.infer<typeof approvalSubmit>;
export type ApprovalVote=z.infer<typeof approvalVote>;
export function canonicalApproval(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonicalApproval).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonicalApproval(v)).join(',')+'}';
 return JSON.stringify(value);
}
export function approvalReceiptMatches(input:ApprovalPolicyCommand|ApprovalSubmit|ApprovalVote,value:unknown):boolean{
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 if(row.requestId!==input.requestId||row.actorId!==input.expectedActorId||row.tenantId!==input.tenantId||row.companyId!==input.companyId||row.branchId!==input.branchId||canonicalApproval(row.command)!==canonicalApproval(input))return false;
 if(row.outcome==='ABANDONED')return !row.policy&&!row.approval&&!row.decision;
 if(row.outcome!=='COMMITTED')return false;
 if('configuration'in input){const p=row.policy as Record<string,unknown>|undefined;return !!p&&p.id===input.policyId&&p.tenantId===input.tenantId&&p.companyId===input.companyId&&p.branchId===input.branchId&&p.version===input.expectedVersion+1&&canonicalApproval(p.configuration)===canonicalApproval(input.configuration);}
 const a=row.approval as Record<string,unknown>|undefined;
 if(!a||a.tenantId!==input.tenantId||a.companyId!==input.companyId||a.branchId!==input.branchId)return false;
 if('sourceId'in input)return a.id===input.requestId&&a.resource===input.resource&&a.sourceId===input.sourceId&&a.policyId===input.policyId&&a.policyVersion===input.policyVersion&&a.sourceFingerprint===input.sourceFingerprint&&a.requesterId===input.expectedActorId&&a.status==='PENDING'&&a.version===1;
 const d=row.decision as Record<string,unknown>|undefined;
 return a.id===input.approvalId&&a.version===input.expectedVersion+1&&!!d&&d.id===input.requestId&&d.approvalId===input.approvalId&&d.actorId===input.expectedActorId&&d.action===input.action&&d.reason===input.reason&&(input.action==='APPROVE'?['PENDING','APPROVED'].includes(String(a.status)):a.status===(input.action==='REJECT'?'REJECTED':'CANCELLED'));
}
export function pendingApproval(value:unknown,actorId:string,scope:z.infer<typeof approvalScope>){
 if(!value||typeof value!=='object')return null;const row=value as Record<string,unknown>;
 if(row.version!==1||row.actorId!==actorId)return null;
 const parsed=z.union([approvalPolicyCommand,approvalSubmit,approvalVote]).safeParse(row.command);
 return parsed.success&&parsed.data.expectedActorId===actorId&&parsed.data.tenantId===scope.tenantId&&parsed.data.companyId===scope.companyId&&parsed.data.branchId===scope.branchId?parsed.data:null;
}
