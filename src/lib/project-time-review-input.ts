import {z} from "zod";
const uuid=z.string().uuid();
export const timeReviewInput=z.object({tenantId:uuid,requestId:uuid,entryId:uuid,expectedSequence:z.number().int().min(0).max(999),state:z.enum(["PENDING","APPROVED","REJECTED"]),reason:z.string().trim().min(3).max(500)}).strict();
export type TimeReviewInput=z.infer<typeof timeReviewInput>;
export function decodeTimeReviewRetry(raw:string|null,tenantId:string,projectId:string,entryId:string){try{if(!raw||raw.length>4000)return null;const p=z.object({version:z.literal(1),projectId:uuid,payload:timeReviewInput}).strict().safeParse(JSON.parse(raw));return p.success&&p.data.projectId===projectId&&p.data.payload.tenantId===tenantId&&p.data.payload.entryId===entryId?p.data.payload:null;}catch{return null;}}
