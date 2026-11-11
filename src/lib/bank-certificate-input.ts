import { z } from "zod";
const uuid = z.string().uuid().transform(value=>value.toLowerCase());
export const certificateDigest = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().trim().max(300).refine(value => !/[\u0000-\u001f]/u.test(value));
export const certificateCreateInput = z.object({tenantId:uuid,requestId:uuid,expectedDigest:certificateDigest,note:note.default("")}).strict();
export const certificateEventInput = z.discriminatedUnion("action",[
 z.object({tenantId:uuid,requestId:uuid,expectedVersion:z.number().int().min(0).max(999),action:z.literal("SUPERSEDE"),replacementId:uuid,reason:note.pipe(z.string().min(3))}).strict(),
 z.object({tenantId:uuid,requestId:uuid,expectedVersion:z.number().int().min(0).max(999),action:z.literal("RESTORE"),reason:note.pipe(z.string().min(3))}).strict(),
]);
export type CertificateCreateInput = z.infer<typeof certificateCreateInput>;
export type CertificateEventInput = z.infer<typeof certificateEventInput>;
