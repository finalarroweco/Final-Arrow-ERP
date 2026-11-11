import { apiJson } from "@/lib/api-response";
import {currentUser} from "@/lib/auth";
import {bankStatementInput} from "@/lib/bank-statement-input";
import {checkBankStatementImport} from "@/lib/bank-statement-import";
import {BankError} from "@/lib/bank-reconciliation";
import {bankExpectedActor,bankFailure} from "@/lib/bank-response";
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 try{bankExpectedActor(request,actor.id);const parsed=bankStatementInput.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new BankError("Invalid saved statement",400);
 return apiJson(await checkBankStatementImport(actor.id,parsed.data),{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return bankFailure(error);}
}
