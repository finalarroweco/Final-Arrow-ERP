import {z} from "zod";
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const text=(max:number)=>z.string().trim().min(3).max(max).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value));
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>value>="2000-01-01"&&value<="2099-12-31"&&Number.isFinite(Date.parse(value+"T00:00:00Z"))&&new Date(value+"T00:00:00Z").toISOString().slice(0,10)===value);
export const paymentTermAmendmentInput=z.object({tenantId:uuid,requestId:uuid,expectedSequence:z.number().int().min(0).max(999),paymentTerms:z.object({label:text(120),dueDate:day}).strict().nullable(),reason:text(1000)}).strict();
export type PaymentTermAmendmentInput=z.infer<typeof paymentTermAmendmentInput>;
export type PaymentTermSourceKind="invoice"|"receipt";
export const paymentTermAmendmentEnvelope=z.object({version:z.literal(1),actorId:uuid,kind:z.enum(["invoice","receipt"]),sourceId:uuid,request:paymentTermAmendmentInput}).strict();
export function pendingPaymentTermAmendment(raw:unknown,actorId:string,tenantId:string,kind:PaymentTermSourceKind,sourceId:string){
 const parsed=paymentTermAmendmentEnvelope.safeParse(raw);
 return parsed.success&&parsed.data.actorId===actorId.toLowerCase()&&parsed.data.request.tenantId===tenantId.toLowerCase()&&parsed.data.kind===kind&&parsed.data.sourceId===sourceId.toLowerCase()?parsed.data.request:null;
}
// Exclusive end-of-day boundary. No local-time arithmetic or user backdated events.
export function paymentTermsCutoff(asOf:string){const value=new Date(asOf+"T00:00:00.000Z");if(!Number.isFinite(value.getTime())||value.toISOString().slice(0,10)!==asOf)throw new Error("Invalid report date");value.setUTCDate(value.getUTCDate()+1);return value;}
type Snapshot={paymentTerms:string|null;paymentDueDate:Date|null};
type Amendment=Snapshot&{sequence:number;createdAt:Date};
export function recordedPaymentTerms(original:Snapshot,amendment?:Amendment|null){const chosen=amendment??original;return {paymentTerms:chosen.paymentTerms,paymentDueDate:chosen.paymentDueDate?.toISOString().slice(0,10)??null,originalPaymentTerms:original.paymentTerms,originalPaymentDueDate:original.paymentDueDate?.toISOString().slice(0,10)??null,paymentTermsSequence:amendment?.sequence??0,paymentTermsRecordedAt:amendment?.createdAt.toISOString()??null};}
