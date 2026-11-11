import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {projectTimeInvoiceRequest} from '@/lib/project-time-invoice-input';
import {mutateProjectTimeInvoice} from '@/lib/project-time-invoicing';
import {BillingError} from '@/lib/recurring-billing';
import {boundedBillingJson,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=projectTimeInvoiceRequest.safeParse(await boundedBillingJson(request));if(!p.success)throw new BillingError('Invalid project time invoice request',400);return apiJson(await mutateProjectTimeInvoice(actor.id,p.data,true),{headers});}catch(e){return billingFailure(e);}}
