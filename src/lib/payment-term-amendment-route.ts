import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {currentUser} from "./auth";
import {paymentTermAmendmentInput,type PaymentTermSourceKind} from "./payment-term-amendment-input";
import {amendPaymentTerms,paymentTermDetails,PaymentTermRequestNotRecorded} from "./payment-term-amendments";
import {operationalFailure} from "./operational-records";
export function paymentTermRoute(kind:PaymentTermSourceKind){
 return {
  async GET(request:Request,{params}:{params:Promise<{id:string}>}){
   const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
   const {id}=await params,query=new URL(request.url).searchParams;
   const parsed=z.object({tenantId:z.string().uuid().transform(value=>value.toLowerCase()),page:z.coerce.number().int().min(0).max(100000).default(0)}).strict().safeParse(Object.fromEntries(query));
   if(!parsed.success||[...query.keys()].some(key=>query.getAll(key).length!==1))return apiJson({error:"Invalid amendment filters"},{status:400});
   try{return apiJson(await paymentTermDetails(actor.id,parsed.data.tenantId,kind,id,parsed.data.page),{headers:{"Cache-Control":"private, no-store"}});}catch(error){const failure=operationalFailure(error);return apiJson({error:failure.error},{status:failure.status});}
  },
  async POST(request:Request,{params}:{params:Promise<{id:string}>}){
   const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
   const {id}=await params,parsed=paymentTermAmendmentInput.safeParse(await request.json().catch(()=>null));
   if(!parsed.success)return apiJson({error:"Invalid payment-term amendment"},{status:400});
   // This is a concurrency guard, never an authorization identity. Reject before
   // any mutation or absence verdict, including previously uncommitted requests.
   const expectedActor=z.string().uuid().transform(value=>value.toLowerCase()).safeParse(request.headers.get("X-Expected-Actor-Id"));
   if(!expectedActor.success||expectedActor.data!==actor.id.toLowerCase())return apiJson({error:"The original operator must be signed in to resolve this request",requestOutcome:{code:"UNRESOLVED",requestId:parsed.data.requestId}},{status:409,headers:{"Cache-Control":"private, no-store"}});
   try{return apiJson(await amendPaymentTerms(actor.id,kind,id,parsed.data),{status:201,headers:{"Cache-Control":"private, no-store"}});}catch(error){const failure=operationalFailure(error);return apiJson({error:failure.error,requestOutcome:{code:error instanceof PaymentTermRequestNotRecorded?"NOT_RECORDED":"UNRESOLVED",requestId:parsed.data.requestId,...(error instanceof PaymentTermRequestNotRecorded?{actorId:actor.id}:{})}},{status:failure.status});}
  }
 };
}
