import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {salesStockRequest} from "@/lib/sales-stock-input";
import {createSalesStockDocument,listSalesStockDocuments,salesStockFilters} from "@/lib/sales-stock";
import {salesStockFailure,salesStockHeaders as headers} from "@/lib/sales-stock-route";
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401,headers});
 const p=salesStockRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return apiJson({error:"Invalid physical stock document request"},{status:400,headers});
 try{return apiJson({document:await createSalesStockDocument(actor.id,p.data)},{status:201,headers});}catch(e){return salesStockFailure(e);}
}
const cell=(v:unknown)=>{const s=String(v??'');return `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(s)?`'${s}`:s).replaceAll('"','""')}"`;};
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401,headers});
 const params=new URL(request.url).searchParams,p=salesStockFilters.safeParse(Object.fromEntries(params));if(!p.success||[...params.keys()].some(k=>params.getAll(k).length!==1))return apiJson({error:"Invalid stock document filters"},{status:400,headers});
 if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403,headers});
 try{const result=await listSalesStockDocuments(actor.id,p.data);if(p.data.format!=='csv')return apiJson({actorId:actor.id,...result},{headers});
 const rows=[["Document ID","Type","Recorded UTC","Order","Customer","Branch","SKU snapshot","Item snapshot","Stock unit snapshot","Quantity","Physical delta","Reference","Reason","Actor","Delivery source","Corrected document","Selected hold","Line position","Line description"],...result.documents.map(d=>[d.id,d.kind,d.createdAt,d.orderNumber,d.customerName,d.branchName,d.itemSku,d.itemName,d.unit,d.quantity,d.delta,d.reference,d.reason,d.actorName,d.deliveryId,d.correctsId,d.holdId,d.linePosition,d.lineDescription])];
 return new Response('\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n',{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="sales-stock-documents.csv"'}});
 }catch(e){return salesStockFailure(e);}
}
