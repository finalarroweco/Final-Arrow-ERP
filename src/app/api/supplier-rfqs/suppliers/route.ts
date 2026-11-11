import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {rfqSupplierFilters,rfqSuppliersResponse} from '@/lib/supplier-rfq-input';
import {RfqError,listRfqSuppliers} from '@/lib/supplier-rfqs';
import {uniqueRfqQuery,rfqFailure,rfqHeaders as headers} from '@/lib/supplier-rfq-route';
export async function GET(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=rfqSupplierFilters.safeParse(uniqueRfqQuery(request));if(!p.success)throw new RfqError('Invalid supplier filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new RfqError('Signed-in user changed. Reload before reading.',403);return apiJson(rfqSuppliersResponse.parse(await listRfqSuppliers(actor.id,p.data)),{headers});}catch(e){return rfqFailure(e);}}
