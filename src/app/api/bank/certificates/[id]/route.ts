import { apiJson } from "@/lib/api-response";
import {certificateRoute,certificateQuery} from "@/lib/bank-certificate-route";
import {getCertificate} from "@/lib/bank-certificates";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return certificateRoute(request,params,async(actor,id)=>{
 const q=certificateQuery(request,false,true),data=await getCertificate(actor,q.tenantId,id);
 if(q.download)return apiJson(data,{headers:{"Cache-Control":"private, no-store","Content-Disposition":`attachment; filename="bank-reconciliation-${id}.json"`,"X-Content-Type-Options":"nosniff"}});
 return data;
});}
