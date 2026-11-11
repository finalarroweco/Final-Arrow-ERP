import { apiJson } from "@/lib/api-response";
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {rfqDetailFilters,rfqDetailResponse} from '@/lib/supplier-rfq-input';
import {RfqError,readRfq} from '@/lib/supplier-rfqs';
import {uniqueRfqQuery,rfqFailure,rfqHeaders as headers} from '@/lib/supplier-rfq-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const id=z.string().uuid().parse((await params).id),p=rfqDetailFilters.safeParse(uniqueRfqQuery(request));if(!p.success)throw new RfqError('Invalid RFQ filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new RfqError('Signed-in user changed. Reload before reading.',403);return apiJson(rfqDetailResponse.parse(await readRfq(actor.id,id,p.data,p.data.page)),{headers});}catch(e){if(e instanceof z.ZodError)return apiJson({error:'Invalid RFQ identity or response'},{status:400,headers});return rfqFailure(e);}}
