import { apiJson } from "@/lib/api-response";
import {Prisma} from "@prisma/client";
import {BankError} from "./bank-reconciliation";
import {bankUuid} from "./bank-allocation-input";
export function bankExpectedActor(request:Request,actorId:string){
 const expected=bankUuid.safeParse(request.headers.get("X-Expected-Actor-Id"));
 if(!expected.success)throw new BankError("The original account is required to confirm this saved request",409,"ACTOR_REQUIRED");
 if(expected.data!==actorId.toLowerCase())throw new BankError("Sign back in with the original account before retrying this saved request",409,"ACTOR_MISMATCH");
}
export function bankFailure(e:unknown){
 const headers={"Cache-Control":"private, no-store"};
 if(e instanceof BankError)return apiJson({error:e.message,...(e.code?{code:e.code}:{})},{status:e.status,headers});
 if(e instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004","P2034"].includes(e.code)||e instanceof Prisma.PrismaClientUnknownRequestError&&e.message.includes("23514"))return apiJson({error:"Statement or allocation conflicts with saved records. Keep the original request and verify its result.",code:"REQUEST_CONFLICT"},{status:409,headers});throw e;
}
