import { z } from "zod";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { certificateFailure, CertificateError } from "./bank-certificates";
export async function certificateRoute(request:Request,params:Promise<{id:string}>,handler:(actorId:string,id:string)=>Promise<unknown>,status=200) {
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401,headers:{"Cache-Control":"private, no-store"}});
 const {id:rawId}=await params,idResult=z.string().uuid().transform(value=>value.toLowerCase()).safeParse(rawId);if(!idResult.success)return NextResponse.json({error:"Invalid snapshot identifier"},{status:400});
 const id=idResult.data;
 try{
  // A concurrency guard, never an authorization identity. Old clients fail closed.
  if(request.method==="POST"){
   const expected=z.string().uuid().transform(value=>value.toLowerCase()).safeParse(request.headers.get("X-Expected-Actor-Id"));
   if(!expected.success)throw new CertificateError("The original account is required to confirm this saved request",409,"ACTOR_REQUIRED");
   if(expected.data!==actor.id.toLowerCase())throw new CertificateError("Sign back in with the original account before retrying this saved request",409,"ACTOR_MISMATCH");
  }
  const result=await handler(actor.id,id);return result instanceof Response?result:NextResponse.json(result,{status,headers:{"Cache-Control":"private, no-store"}});}catch(error){return certificateFailure(error);}
}
export function certificateQuery(request:Request,paged=false,download=false) {
 const q=new URL(request.url).searchParams,shape={tenantId:z.string().uuid().transform(value=>value.toLowerCase()),...(download?{format:z.literal("json").optional()}:{})},schema=paged?z.object({...shape,page:z.coerce.number().int().min(0).max(10000).default(0)}).strict():z.object(shape).strict();
 const parsed=schema.safeParse(Object.fromEntries(q));if(!parsed.success||[...q.keys()].some(key=>q.getAll(key).length!==1))throw new CertificateError("Invalid snapshot scope",400);
 return {...parsed.data,page:"page" in parsed.data?Number(parsed.data.page):0,download:download&&q.get("format")==="json"};
}
