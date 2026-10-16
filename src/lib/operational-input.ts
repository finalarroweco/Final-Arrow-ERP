import {z} from "zod";
export const uuid=z.string().uuid();
export const contactFields={displayName:z.string().trim().min(2).max(160),email:z.string().trim().email().max(255).nullable().default(null),phone:z.string().trim().max(40).nullable().default(null),title:z.string().trim().max(120).nullable().default(null),notes:z.string().trim().max(2000).nullable().default(null)};
export const operationalRetry=z.discriminatedUnion("kind",[z.object({version:z.literal(1),kind:z.literal("contact"),parentId:uuid,payload:z.object({tenantId:uuid,requestId:uuid,...contactFields}).strict()}).strict(),z.object({version:z.literal(1),kind:z.literal("message"),parentId:uuid,payload:z.object({tenantId:uuid,requestId:uuid,body:z.string().trim().min(1).max(4000)}).strict()}).strict()]);
export type OperationalRetry=z.infer<typeof operationalRetry>;
export function decodeOperationalRetry(raw:string|null,kind:"contact"|"message",tenantId:string,parentId:string){try{if(!raw||raw.length>20000)return null;const p=operationalRetry.safeParse(JSON.parse(raw));return p.success&&p.data.kind===kind&&p.data.parentId===parentId&&p.data.payload.tenantId===tenantId?p.data:null;}catch{return null;}}
