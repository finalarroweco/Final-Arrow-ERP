import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {readStockTransfer} from "@/lib/stock-transfers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 const {id}=await params,query=new URL(request.url).searchParams;
 const p=z.object({expectedActorId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),tenantId:z.string().uuid().transform(v=>v.toLowerCase())}).strict().safeParse(Object.fromEntries(query));
 if(!p.success||!z.string().uuid().safeParse(id).success||[...query.keys()].some(k=>query.getAll(k).length!==1))return apiJson({error:"Invalid transfer scope"},{status:400});
 if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403,headers:{"Cache-Control":"private, no-store"}});
 const transfer=await readStockTransfer(actor.id,id,p.data.tenantId);
 return apiJson(transfer?{actorId:actor.id,transfer}:{error:"Transfer not found"},{status:transfer?200:404,headers:{"Cache-Control":"private, no-store"}});
}
