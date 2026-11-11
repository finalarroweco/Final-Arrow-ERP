import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {bankFailure,bankExpectedActor} from "@/lib/bank-response";
import {importBankStatement} from "@/lib/bank-statement-import";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,bankScope,bankStatementInput,BankError} from "@/lib/bank-reconciliation";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});const q=new URL(request.url).searchParams;
 const parsed=bankScope.extend({expectedActorId:z.string().uuid().transform(value=>value.toLowerCase()).optional(),page:z.coerce.number().int().min(0).max(10000).default(0)}).strict().safeParse(Object.fromEntries(q));if(!parsed.success||[...q.keys()].some(k=>q.getAll(k).length!==1))return apiJson({error:"Invalid scope"},{status:400});
 if(parsed.data.expectedActorId&&parsed.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403});
 const {tenantId,companyId,page}=parsed.data;if(!(await bankAllowed(actor.id,tenantId,companyId)))return apiJson({error:"Company-wide ledger read permission required"},{status:403});
 const rows=await db.bankStatement.findMany({where:{tenantId,companyId},include:{account:{select:{code:true,name:true}},_count:{select:{lines:true}}},orderBy:[{to:"desc"},{id:"asc"}],skip:page*50,take:51});return apiJson({actorId:actor.id,statements:rows.slice(0,50),nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 try{bankExpectedActor(request,actor.id);const parsed=bankStatementInput.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new BankError("Invalid statement (maximum 500 movements, 366 days)",400);
 return apiJson(await importBankStatement(actor.id,parsed.data),{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return bankFailure(e);}
}
