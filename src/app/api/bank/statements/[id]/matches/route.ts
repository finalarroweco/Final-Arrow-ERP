import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {bankFailure,bankExpectedActor} from "@/lib/bank-response";
import {bankMatchInput,bankUuid} from "@/lib/bank-allocation-input";
import {allocateBank} from "@/lib/bank-allocation";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 try{
  bankExpectedActor(request,actor.id);
  const {id:rawId}=await params,id=bankUuid.safeParse(rawId),parsed=bankMatchInput.safeParse(await request.json().catch(()=>null));
  if(!id.success||!parsed.success)return apiJson({error:"Invalid allocation"},{status:400});
  return apiJson(await allocateBank(actor.id,id.data,parsed.data),{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return bankFailure(error);}
}
