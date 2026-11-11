import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {returnRegister,ReturnRegisterError} from "@/lib/return-register";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>params.getAll(k).length!==1))return apiJson({error:"Duplicate return filter"},{status:400});
 try{return apiJson(await returnRegister(actor.id,Object.fromEntries(params)),{headers:{"Cache-Control":"private, no-store"}});}
 catch(e){if(e instanceof ReturnRegisterError)return apiJson({error:e.message},{status:e.status});throw e;}
}
