import {z} from "zod";
const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const text=(max:number)=>z.string().trim().min(3).max(max).refine(value=>!/[\u0000-\u001f\u007f]/u.test(value));
export const orderStockHoldScope=z.object({tenantId:uuid,companyId:uuid,branchId:uuid});
export const orderStockHoldRequest=z.discriminatedUnion("action",[
 orderStockHoldScope.extend({action:z.literal("reserve"),expectedActorId:uuid,requestId:uuid,itemId:uuid,expectedUnit:z.string().regex(/^[A-Za-z0-9-]{1,16}$/),quantity:z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/),lineId:uuid.optional(),note:text(120)}).strict(),
 orderStockHoldScope.extend({action:z.literal("release"),expectedActorId:uuid,requestId:uuid,reservationId:uuid,reason:text(200)}).strict(),
]);
export type OrderStockHoldRequest=z.infer<typeof orderStockHoldRequest>;
export type OrderHoldSource={tenantId:string;companyId:string;id:string};
export function pendingOrderStockHold(raw:unknown,actorId:string,source:OrderHoldSource){
 const p=z.object({version:z.literal(1),actorId:uuid,orderId:uuid,request:orderStockHoldRequest}).strict().safeParse(raw);
 return p.success&&p.data.actorId===actorId.toLowerCase()&&p.data.request.expectedActorId===p.data.actorId&&p.data.orderId===source.id.toLowerCase()&&p.data.request.tenantId===source.tenantId.toLowerCase()&&p.data.request.companyId===source.companyId.toLowerCase()?p.data.request:null;
}
const amount=z.string().regex(/^\d+(?:\.\d{1,3})?$/);
const timestamp=z.string().datetime();
export const orderStockHoldRow=z.object({id:uuid,tenantId:uuid,balanceId:uuid,quantity:amount,reference:z.string(),createdBy:uuid,createdAt:timestamp,releasedBy:uuid.nullable(),releasedAt:timestamp.nullable(),releaseReason:z.string().nullable(),releaseRequestId:uuid.nullable(),orderLink:z.object({orderId:uuid,lineId:uuid.nullable(),note:z.string(),orderNumber:z.string(),customerName:z.string(),linePosition:z.number().int().nullable(),lineDescription:z.string().nullable(),itemSku:z.string(),itemName:z.string(),itemUnit:z.string(),branchName:z.string()}),balance:z.object({itemId:uuid,branchId:uuid,companyId:uuid,quantity:amount.optional(),reservedQuantity:amount.optional(),item:z.object({unit:z.string()}).optional()})});
export type OrderStockHoldRow=z.infer<typeof orderStockHoldRow>;
const decimal=(s:string)=>{const [whole,fraction=""]=s.split(".");return `${whole.replace(/^0+(?=\d)/,"")}.${fraction.padEnd(3,"0")}`;};
export function confirmedOrderStockHold(raw:unknown,request:OrderStockHoldRequest,actorId:string,orderId:string){
 const expected=orderStockHoldRequest.safeParse(request);if(!expected.success||expected.data.expectedActorId!==actorId.toLowerCase())return false;request=expected.data;
 const p=z.object({reservation:orderStockHoldRow}).safeParse(raw);if(!p.success)return false;const r=p.data.reservation;
 if(r.tenantId!==request.tenantId||r.balance.companyId!==request.companyId||r.balance.branchId!==request.branchId||r.orderLink.orderId!==orderId.toLowerCase())return false;
 if(request.action==="reserve")return r.id===request.requestId&&r.createdBy===actorId.toLowerCase()&&r.balance.itemId===request.itemId&&decimal(r.quantity)===decimal(request.quantity)&&r.orderLink.lineId===(request.lineId??null)&&r.orderLink.note===request.note&&r.orderLink.itemUnit===request.expectedUnit;
 return r.id===request.reservationId&&r.releaseRequestId===request.requestId&&r.releasedBy===actorId.toLowerCase()&&Boolean(r.releasedAt)&&r.releaseReason===request.reason;
}
export function orderHoldCsv(rows:OrderStockHoldRow[],page:number){
 // Spreadsheet programs may ignore leading whitespace/control characters.
 const cell=(v:unknown)=>{const value=String(v??"");return `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?"'"+value:value).replaceAll('"','""')}"`;};
 return [["Order-linked manual holds: current page only",page+1],["Reservation ID","Order","Customer","Branch","Source line","Line description","SKU snapshot","Item snapshot","Unit snapshot","Stock quantity","Note","Created UTC","Created by","Released UTC","Released by","Release reason"],...rows.map(r=>[r.id,r.orderLink.orderNumber,r.orderLink.customerName,r.orderLink.branchName,r.orderLink.linePosition,r.orderLink.lineDescription,r.orderLink.itemSku,r.orderLink.itemName,r.orderLink.itemUnit,r.quantity,r.orderLink.note,r.createdAt,r.createdBy,r.releasedAt,r.releasedBy,r.releaseReason])].map(row=>row.map(cell).join(",")).join("\r\n");
}
// Quantities are stock-unit decimals, never sales quantities or floating-point values.
export function availableOrderStock(quantity:string,reserved:string){const units=(v:string)=>BigInt(v.split(".")[0])*BigInt(1000)+BigInt((v.split(".")[1]??"").padEnd(3,"0"));const value=units(quantity)-units(reserved);return `${value/BigInt(1000)}.${(value%BigInt(1000)).toString().padStart(3,"0")}`;}
// Only the authenticated, UUID-serialized terminal-order verdict is discardable.
// Generic conflicts and missing/access-denied responses are still uncertain.
export function confirmedClosedOrderStockHold(raw:unknown,request:OrderStockHoldRequest,actorId:string,orderId:string){
 const p=z.object({error:z.string(),code:z.literal("NOT_RECORDED_CLOSED"),outcome:z.object({actorId:uuid,orderId:uuid,orderStatus:z.enum(["COMPLETED","CANCELLED"]),request:orderStockHoldRequest}).strict()}).strict().safeParse(raw);
 const expected=orderStockHoldRequest.safeParse(request);
 return p.success&&expected.success&&expected.data.expectedActorId===actorId.toLowerCase()&&expected.data.action==="reserve"&&p.data.outcome.request.action==="reserve"&&p.data.outcome.actorId===actorId.toLowerCase()&&p.data.outcome.orderId===orderId.toLowerCase()&&JSON.stringify(p.data.outcome.request)===JSON.stringify(expected.data);
}
