import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {bankUuid,bankResolvableInput} from "@/lib/bank-allocation-input";
import {bankFailure,bankExpectedActor} from "@/lib/bank-response";
import {resolveBankRequest} from "@/lib/bank-request-resolution";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 try{
  bankExpectedActor(request,actor.id);const id=bankUuid.safeParse((await params).id),parsed=z.object({tenantId:bankUuid,request:bankResolvableInput}).strict().safeParse(await request.json().catch(()=>null));
  if(!id.success||!parsed.success||parsed.data.tenantId!==parsed.data.request.tenantId)return NextResponse.json({error:"Invalid saved bank request"},{status:400});
  return NextResponse.json(await resolveBankRequest(actor.id,id.data,parsed.data.request),{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return bankFailure(error);}
}
