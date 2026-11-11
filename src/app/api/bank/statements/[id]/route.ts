import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,reconciliation} from "@/lib/bank-reconciliation";
import {bankTenantLock,requireBankAccess} from "@/lib/bank-allocation";
import {bankFailure} from "@/lib/bank-response";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});const {id}=await params,q=new URL(request.url).searchParams;
 const parsed=z.object({tenantId:z.string().uuid().transform(value=>value.toLowerCase()),expectedActorId:z.string().uuid().transform(value=>value.toLowerCase()).optional()}).strict().safeParse(Object.fromEntries(q));
 if(!z.string().uuid().safeParse(id).success||!parsed.success||[...q.keys()].some(k=>q.getAll(k).length!==1))return apiJson({error:"Invalid statement"},{status:400});
 if(parsed.data.expectedActorId&&parsed.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403});
 const tenantId=parsed.data.tenantId;
 const s=await db.bankStatement.findFirst({where:{id,tenantId:tenantId!},select:{companyId:true}});if(!s)return apiJson({error:"Statement not found"},{status:404});if(!(await bankAllowed(actor.id,tenantId!,s.companyId)))return apiJson({error:"Company-wide ledger read permission required"},{status:403});
 try{return apiJson({actorId:actor.id,...await db.$transaction(async tx=>{await bankTenantLock(tx,tenantId!);await requireBankAccess(tx,actor.id,tenantId!,s.companyId);return reconciliation(tx,id,tenantId!);},{isolationLevel:"ReadCommitted",timeout:15000,maxWait:10000})},{headers:{"Cache-Control":"private, no-store"}});}catch(e){return bankFailure(e);}
}
