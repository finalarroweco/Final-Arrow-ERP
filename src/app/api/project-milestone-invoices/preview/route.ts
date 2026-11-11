import {apiJson} from '@/lib/api-response';
import {currentUser} from '@/lib/auth';
import {BillingError} from '@/lib/recurring-billing';
import {boundedBillingJson,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
import {apiMutationFailure} from '@/lib/request-security';
import {milestoneInvoiceSelection} from '@/lib/project-milestone-input';
import {previewMilestoneInvoice} from '@/lib/project-milestone-invoicing';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=milestoneInvoiceSelection.safeParse(await boundedBillingJson(request));if(!p.success)throw new BillingError('Invalid milestone request',400);return apiJson(await previewMilestoneInvoice(actor.id,p.data),{headers});}catch(e){return billingFailure(e);}}
