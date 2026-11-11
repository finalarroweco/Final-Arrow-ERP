import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {rfqRequest,rfqFilters,rfqListResponse} from '@/lib/supplier-rfq-input';
import {RfqError,mutateRfq,listRfqs} from '@/lib/supplier-rfqs';
import {boundedRfqJson,uniqueRfqQuery,rfqFailure,rfqHeaders as headers} from '@/lib/supplier-rfq-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=rfqRequest.safeParse(await boundedRfqJson(request));if(!p.success)throw new RfqError('Invalid RFQ request',400);return apiJson(await mutateRfq(actor.id,p.data),{status:201,headers});}catch(e){return rfqFailure(e);}}
export async function GET(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=rfqFilters.safeParse(uniqueRfqQuery(request));if(!p.success)throw new RfqError('Invalid RFQ filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new RfqError('Signed-in user changed. Reload before reading.',403);return apiJson(rfqListResponse.parse(await listRfqs(actor.id,p.data)),{headers});}catch(e){return rfqFailure(e);}}
