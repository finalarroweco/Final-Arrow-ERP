import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {salesStockRequest} from "@/lib/sales-stock-input";
import {cancelSalesStockRequest} from "@/lib/sales-stock";
import {salesStockFailure,salesStockHeaders as headers} from "@/lib/sales-stock-route";
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401,headers});
 const p=salesStockRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return apiJson({error:"Invalid saved stock document request"},{status:400,headers});
 try{return apiJson(await cancelSalesStockRequest(actor.id,p.data),{headers});}catch(e){return salesStockFailure(e);}
}
