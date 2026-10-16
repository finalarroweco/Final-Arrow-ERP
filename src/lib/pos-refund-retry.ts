export type PosRefundRetry={tenantId:string;requestId:string;entryDate:string;reference:string;reason:string;lines?:{orderLineId:string;quantity:number}[]};
export const posRefundRetryKey=(tenantId:string,orderId:string)=>`erp:pos-refund:v1:${tenantId}:${orderId}`;
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
export function decodePosRefundRetry(raw:string|null,tenantId:string):PosRefundRetry|null{
 if(!raw||raw.length>20000)return null;
 try{const stored=JSON.parse(raw);if(stored?.version!==1)return null;const p=stored.payload;
  if(!p||p.tenantId!==tenantId||!uuid(p.tenantId)||!uuid(p.requestId)||typeof p.entryDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(p.entryDate)||!Number.isFinite(Date.parse(`${p.entryDate}T00:00:00Z`))||typeof p.reference!=="string"||p.reference.trim().length<3||p.reference.length>120||typeof p.reason!=="string"||p.reason.trim().length<3||p.reason.length>500)return null;
  if(p.lines!==undefined&&(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>100||p.lines.some((l:unknown)=>!l||typeof l!=="object"||!("orderLineId" in l)||!uuid(l.orderLineId)||!("quantity" in l)||!Number.isInteger(l.quantity)||Number(l.quantity)<1||Number(l.quantity)>999)||new Set(p.lines.map((l:{orderLineId:string})=>l.orderLineId.toLowerCase())).size!==p.lines.length))return null;
  return{tenantId:p.tenantId,requestId:p.requestId,entryDate:p.entryDate,reference:p.reference,reason:p.reason,...(p.lines?{lines:p.lines.map((l:{orderLineId:string;quantity:number})=>({orderLineId:l.orderLineId,quantity:l.quantity}))}:{})};
 }catch{return null;}
}
