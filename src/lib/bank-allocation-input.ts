import {z} from "zod";
export const bankUuid=z.string().uuid().transform(value=>value.toLowerCase());
export const allocationAmount=z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/).refine(value=>/[1-9]/.test(value)).transform(value=>{const [whole,fraction=""]=value.split(".");return `${whole}.${fraction.padEnd(3,"0")}`;});
const pair={tenantId:bankUuid,requestId:bankUuid,bankLineId:bankUuid,journalLineId:bankUuid};
export const bankMatchInput=z.discriminatedUnion("action",[
 z.object({...pair,action:z.literal("match")}).strict(),
 z.object({...pair,action:z.literal("allocate"),amount:allocationAmount}).strict(),
 z.object({tenantId:bankUuid,action:z.literal("cancel"),requestId:bankUuid.optional(),matchId:bankUuid,reason:z.string().trim().min(3).max(300)}).strict()
]);
export type BankMatchInput=z.infer<typeof bankMatchInput>;

export const bankVoidInput=z.object({tenantId:bankUuid,action:z.literal("void"),requestId:bankUuid.optional(),reason:z.string().trim().min(3).max(300)}).strict();
export const bankResolvableInput=z.union([bankMatchInput,bankVoidInput]).refine(p=>!!p.requestId,"Request ID required");
export type BankRequest=z.infer<typeof bankMatchInput>|z.infer<typeof bankVoidInput>;
