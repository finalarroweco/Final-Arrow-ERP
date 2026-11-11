import {z} from 'zod';
import {recurringLines,recurringTerms,recurringCadence} from '@/lib/recurring-input';
import {alertConfig} from '@/lib/private-alert-input';
import {automationCommand,automationConfig,type AutomationCommand} from '@/lib/automation-input';
const uuid=z.string().uuid(), date=z.string().datetime();
const receipt=z.object({requestId:uuid,jobId:uuid,actorId:uuid,outcome:z.enum(['COMMITTED','ABANDONED']),request:automationCommand}).strict();
export type AutomationReceipt=z.infer<typeof receipt>;
// Compare parsed semantic fields, not property order, while rejecting unknown fields.
function equal(a:unknown,b:unknown):boolean {
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
 return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&equal(x[k],y[k]));
}
export function automationReceiptMatches(command:AutomationCommand,value:unknown):value is AutomationReceipt {
 const r=receipt.safeParse(value);
 return r.success&&r.data.requestId===command.requestId&&r.data.jobId===command.jobId&&r.data.actorId===command.expectedActorId&&equal((value as AutomationReceipt).request,command);
}
export const automationListing=z.object({actorId:uuid,tenantId:uuid,companyId:uuid,branchId:uuid.nullable(),page:z.number().int().min(0),nextPage:z.number().int().min(0).nullable(),jobs:z.array(z.object({id:uuid,kind:z.enum(['RECURRING_DRAFT','PRIVATE_ALERT']),sourceId:uuid,state:z.string(),version:z.number().int().positive(),config:automationConfig,nextDueAt:date.nullable(),runsUsed:z.number().int().min(0),cursor:z.number().int().nullable(),lastCode:z.string().nullable(),createdAt:date})),runs:z.array(z.object({id:uuid,jobId:uuid,sequence:z.number().int(),state:z.string(),attempts:z.number().int().min(0),scheduledAt:date,leaseUntil:date.nullable(),nextAttemptAt:date.nullable(),code:z.string().nullable(),createdAt:date,finishedAt:date.nullable()})),runner:z.object({enabled:z.boolean(),configured:z.boolean()})});
const calendarDate=z.string().refine(v=>/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v)&&Number.isFinite(Date.parse(v)));
const vatProfile=z.object({revision:z.number().int().positive(),enabled:z.boolean(),taxNumber:z.string().nullable(),sellerName:z.string().nullable(),sellerAddress:z.string().nullable(),effectiveFrom:calendarDate.nullable(),outputAccountId:uuid.nullable(),inputAccountId:uuid.nullable()}).passthrough();
const recurringAuthorization=z.object({subscriptionVersion:z.number().int().positive(),effectivePeriod:z.number().int().min(0).max(100000),subscriptionRevisionId:uuid,planRevisionId:uuid,planVersion:z.number().int().positive(),currency:z.string().regex(/^[A-Z]{3}$/),planLabel:z.string().min(1),lines:recurringLines,terms:recurringTerms,anchor:calendarDate,cadence:recurringCadence,horizon:calendarDate,vatProfile:vatProfile.nullable()}).strict();
const alertAuthorization=z.object({ruleVersion:z.number().int().positive(),kind:z.enum(['TICKET_DEADLINE','SUBSCRIPTION_REVIEW','STOCK_REORDER']),branchId:uuid.nullable(),lookbackDays:z.number().int().nullable(),horizonDays:z.number().int().nullable(),priority:z.string().nullable()}).strict().refine(({ruleVersion,...config})=>ruleVersion>0&&alertConfig.safeParse(config).success);
const previewBase=z.object({actorId:uuid,sourceFingerprint:z.string().regex(/^[a-f0-9]{32}$/),sourceId:uuid});
export const previewReceipt=z.discriminatedUnion('kind',[
 previewBase.extend({kind:z.literal('RECURRING_DRAFT'),authorization:recurringAuthorization}).strict(),
 previewBase.extend({kind:z.literal('PRIVATE_ALERT'),authorization:alertAuthorization}).strict(),
]);
export type AutomationPreview=z.infer<typeof previewReceipt>;
export type AutomationListing=z.infer<typeof automationListing>;
