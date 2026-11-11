import {z} from 'zod';
import {approvalConfiguration,approvalResource} from '@/lib/approval-workflow-input';
import type {Scope} from './types';
const uuid=z.string().uuid(),scope={tenantId:uuid,companyId:uuid,branchId:uuid.nullable()},page=z.number().int().nonnegative(),nextPage=page.nullable();
const base=z.object({actorId:uuid,...scope});
export const policyRow=z.object({...scope,id:uuid,version:z.number().int().positive(),configuration:approvalConfiguration});
export const approvalRow=z.object({...scope,id:uuid,resource:approvalResource,sourceId:uuid,policyId:uuid,policyVersion:z.number().int().positive(),policySnapshot:approvalConfiguration,sourceSnapshot:z.record(z.string(),z.unknown()),sourceFingerprint:z.string().regex(/^[a-f0-9]{32}$/),requesterId:uuid,status:z.enum(['PENDING','APPROVED','REJECTED','CANCELLED']),stage:page,version:z.number().int().positive(),createdAt:z.string()});
const decision=z.object({id:uuid,approvalId:uuid,actorId:uuid,stage:page,action:z.enum(['APPROVE','REJECT','CANCEL']),reason:z.string(),createdAt:z.string()});
export const listSchema=base.extend({items:z.array(approvalRow).max(50),page,nextPage,canManagePolicies:z.boolean()});
export const detailSchema=base.extend({sourceCurrent:z.boolean().nullable().optional(),approval:approvalRow,decisions:z.array(decision).max(50),page,nextPage,eligible:z.boolean(),blockedReason:z.enum(['TERMINAL','POLICY_CHANGED','SOURCE_CHANGED','SELF_APPROVAL','PRIOR_APPROVER_CHANGED','NOT_ELIGIBLE']).nullable().optional(),canCancel:z.boolean()});
export const previewSchema=base.extend({sourceCurrent:z.boolean().nullable().optional(),sourceReady:z.boolean(),resource:approvalResource,sourceId:uuid,source:z.record(z.string(),z.unknown()),sourceFingerprint:z.string().regex(/^[a-f0-9]{32}$/),policy:policyRow.nullable(),approval:approvalRow.nullable()});
export const policiesSchema=base.extend({policies:z.array(policyRow).max(50),revisions:z.array(z.object({id:uuid,policyId:uuid,version:z.number().int().positive(),configuration:approvalConfiguration,actorId:uuid,createdAt:z.string()})).max(50),members:z.array(z.object({id:uuid,name:z.string()})),roles:z.array(z.object({id:uuid,name:z.string()})),page,nextPage});
export function sameScope(value:unknown,s:Scope){if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;return row.tenantId===s.tenantId&&row.companyId===s.companyId&&row.branchId===s.branchId;}
export function responseIdentity(value:unknown,actorId:string,s:Scope){return sameScope(value,s)&&(value as Record<string,unknown>).actorId===actorId;}
export function sourceLink(s:Scope,resource:string,sourceId:string){return `/approvals/workflows?${new URLSearchParams({tenantId:s.tenantId,companyId:s.companyId,branchId:s.branchId??'company',resource,sourceId})}`;}
