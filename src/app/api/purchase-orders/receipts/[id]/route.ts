import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {readableGoodsReceipt} from "@/lib/goods-receipt";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 const format=new URL(request.url).searchParams;if(format.getAll("format").length>1||!['json','csv'].includes(format.get("format")??"json"))return apiJson({error:"Invalid format"},{status:400});
 const {id}=await params;const receipt=await readableGoodsReceipt(actor.id,id);if(!receipt)return apiJson({error:"Receipt not found"},{status:404});
 if(format.get("format")!=="csv")return apiJson({receipt},{headers:{"Cache-Control":"private, no-store"}});
 const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
 const content=[["Receipt ID","Purchase order","Saved supplier name","Branch","Received at UTC","Order line description","Current SKU","Current item name","Current unit","Received quantity","Stock movement ID"],...receipt.lines.map(line=>[receipt.id,receipt.order.number,receipt.order.supplierName,receipt.branch.name,receipt.createdAt.toISOString(),line.orderLine.description,line.item.sku,line.item.name,line.item.unit,line.quantity.toFixed(3),line.movement?.id??""])].map(row=>row.map(cell).join(",")).join("\r\n");
 return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="goods-receipt-${receipt.id}.csv"`,"Cache-Control":"private, no-store"}});
}
