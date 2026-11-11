import {z} from "zod";
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const quantity=z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
export const stockTransferScope=z.object({tenantId:uuid,companyId:uuid});
export const stockTransferRequest=z.discriminatedUnion("action",[
 stockTransferScope.extend({action:z.literal("transfer"),expectedActorId:uuid,requestId:uuid,sourceBranchId:uuid,destinationBranchId:uuid,itemId:uuid,expectedUnit:z.string().regex(/^[A-Za-z0-9-]{1,16}$/),quantity,reference:z.string().trim().min(3).max(120),reason:z.string().trim().min(3).max(300)}).strict(),
 stockTransferScope.extend({action:z.literal("correct"),expectedActorId:uuid,requestId:uuid,transferId:uuid,reason:z.string().trim().min(3).max(300)}).strict(),
]).refine(v=>v.action!=="transfer"||v.sourceBranchId!==v.destinationBranchId);
export type StockTransferRequest=z.infer<typeof stockTransferRequest>;
export function pendingStockTransfer(raw:unknown,actorId:string,scope:z.infer<typeof stockTransferScope>){
 const p=z.object({version:z.literal(1),actorId:uuid,request:stockTransferRequest}).strict().safeParse(raw);
 return p.success&&p.data.actorId===actorId&&p.data.request.expectedActorId===actorId&&p.data.request.tenantId===scope.tenantId&&p.data.request.companyId===scope.companyId?p.data.request:null;
}
export const normalizedTransferQuantity=(v:string)=>{const [whole,part=""]=v.split(".");return `${whole}.${part.padEnd(3,"0")}`;};
export function stockTransferResponseMatches(request:StockTransferRequest,raw:unknown){
 const p=z.object({id:uuid,tenantId:uuid,companyId:uuid,createdBy:uuid,createdAt:z.string().datetime(),reason:z.string(),correctsId:uuid.nullable(),sourceBranchId:uuid,destinationBranchId:uuid,itemId:uuid,quantity,reference:z.string(),unit:z.string().min(1),itemName:z.string(),itemSku:z.string(),companyName:z.string(),sourceBranchName:z.string(),destinationBranchName:z.string(),actorName:z.string()}).safeParse(raw);
 if(!p.success)return false;const s=p.data;
 return s.createdBy===request.expectedActorId&&s.id===request.requestId&&s.tenantId===request.tenantId&&s.companyId===request.companyId&&s.reason===request.reason&&(request.action==="correct"?s.correctsId===request.transferId:s.correctsId===null&&s.unit===request.expectedUnit&&s.sourceBranchId===request.sourceBranchId&&s.destinationBranchId===request.destinationBranchId&&s.itemId===request.itemId&&normalizedTransferQuantity(s.quantity)===normalizedTransferQuantity(request.quantity)&&s.reference===request.reference);
}

export function canonicalTransferRequest(value:StockTransferRequest){const request=stockTransferRequest.parse(value);return request.action==="transfer"?{...request,quantity:normalizedTransferQuantity(request.quantity)}:request;}
export function stockTransferCancellationMatches(request:StockTransferRequest,raw:unknown,actorId:string){
 const p=z.object({id:uuid,tenantId:uuid,companyId:uuid,createdBy:uuid,createdAt:z.string().datetime(),request:stockTransferRequest}).safeParse(raw);
 return p.success&&p.data.id===request.requestId&&p.data.tenantId===request.tenantId&&p.data.companyId===request.companyId&&p.data.createdBy===actorId&&JSON.stringify(canonicalTransferRequest(p.data.request))===JSON.stringify(canonicalTransferRequest(request));
}
