import {z} from "zod";
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
const text=(max:number)=>z.string().trim().min(3).max(max).refine(v=>!/[\u0000-\u001f\u007f]/u.test(v));
const quantity=z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
const unit=z.string().regex(/^[A-Za-z0-9-]{1,16}$/);
export const salesStockScope=z.object({tenantId:uuid,companyId:uuid,orderId:uuid});
const common=salesStockScope.extend({expectedActorId:uuid,requestId:uuid,expectedUnit:unit,reason:text(300)});
export const salesStockRequest=z.discriminatedUnion("action",[
 common.extend({action:z.literal("deliver"),branchId:uuid,itemId:uuid,lineId:uuid.nullable(),holdId:uuid.nullable(),quantity,reference:text(120),physicalConfirmed:z.literal(true)}).strict(),
 common.extend({action:z.literal("return"),deliveryId:uuid,quantity,reference:text(120),usableConfirmed:z.literal(true)}).strict(),
 common.extend({action:z.literal("correct"),documentId:uuid,physicalConfirmed:z.literal(true)}).strict(),
]);
export type SalesStockRequest=z.infer<typeof salesStockRequest>;
export const normalizedSalesQuantity=(v:string)=>{const [whole,part=""]=v.split(".");return `${whole}.${part.padEnd(3,"0")}`;};
export function canonicalSalesStockRequest(value:SalesStockRequest){const p=salesStockRequest.parse(value);return p.action==='correct'?p:{...p,quantity:normalizedSalesQuantity(p.quantity)};}
export function pendingSalesStock(raw:unknown,actorId:string,source:{id:string;tenantId:string;companyId:string}){
 const p=z.object({version:z.literal(1),actorId:uuid,orderId:uuid,request:salesStockRequest}).strict().safeParse(raw);
 return p.success&&p.data.actorId===actorId&&p.data.request.expectedActorId===actorId&&p.data.orderId===source.id&&p.data.request.orderId===source.id&&p.data.request.tenantId===source.tenantId&&p.data.request.companyId===source.companyId?p.data.request:null;
}
export const salesStockRow=z.object({id:uuid,tenantId:uuid,companyId:uuid,orderId:uuid,lineId:uuid.nullable(),branchId:uuid,itemId:uuid,balanceId:uuid,kind:z.enum(['DELIVERY','RETURN','CORRECTION']),deliveryId:uuid.nullable(),correctsId:uuid.nullable(),holdId:uuid.nullable(),releaseRequestId:uuid.nullable(),quantity,delta:z.string().regex(/^-?\d+(?:\.\d{1,3})?$/),unit,reference:z.string(),reason:z.string(),physicalConfirmed:z.literal(true),createdBy:uuid,createdAt:z.string().datetime(),orderNumber:z.string(),customerName:z.string(),linePosition:z.number().int().nullable(),lineDescription:z.string().nullable(),itemName:z.string(),itemSku:z.string(),branchName:z.string(),companyName:z.string(),actorName:z.string()});
export type SalesStockRow=z.infer<typeof salesStockRow>;
// The server's immutable document, never a request echo, binds each successful action UUID.
export function salesStockResponseMatches(request:SalesStockRequest,raw:unknown){
 const parsed=salesStockRow.safeParse(raw);if(!parsed.success)return false;const s=parsed.data;
 if(normalizedSalesQuantity(s.delta.replace(/^-/u,""))!==normalizedSalesQuantity(s.quantity))return false;
 if(s.id!==request.requestId||s.tenantId!==request.tenantId||s.companyId!==request.companyId||s.orderId!==request.orderId||s.createdBy!==request.expectedActorId||s.unit!==request.expectedUnit||s.reason!==request.reason)return false;
 if(request.action==='correct')return s.kind==='CORRECTION'&&s.correctsId===request.documentId&&s.deliveryId===null&&s.holdId===null&&s.releaseRequestId===null;
 if(normalizedSalesQuantity(s.quantity)!==normalizedSalesQuantity(request.quantity)||s.reference!==request.reference||s.correctsId!==null)return false;
 if(request.action==='return')return s.kind==='RETURN'&&s.deliveryId===request.deliveryId&&s.holdId===null&&s.releaseRequestId===null&&s.delta===normalizedSalesQuantity(request.quantity);
 return s.kind==='DELIVERY'&&s.deliveryId===null&&s.branchId===request.branchId&&s.itemId===request.itemId&&s.lineId===request.lineId&&s.holdId===request.holdId&&s.releaseRequestId===(request.holdId?request.requestId:null)&&s.delta===`-${normalizedSalesQuantity(request.quantity)}`;
}
export function salesStockCancellationMatches(request:SalesStockRequest,raw:unknown){
 const p=z.object({id:uuid,tenantId:uuid,companyId:uuid,createdBy:uuid,createdAt:z.string().datetime(),request:salesStockRequest}).safeParse(raw);
 return p.success&&p.data.id===request.requestId&&p.data.tenantId===request.tenantId&&p.data.companyId===request.companyId&&p.data.createdBy===request.expectedActorId&&JSON.stringify(canonicalSalesStockRequest(p.data.request))===JSON.stringify(canonicalSalesStockRequest(request));
}
