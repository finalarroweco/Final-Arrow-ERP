import {apiJson} from '@/lib/api-response';
import {currentUser} from '@/lib/auth';
import {BillingError} from '@/lib/recurring-billing';
import {boundedBillingJson,uniqueBillingQuery,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
import {apiMutationFailure} from '@/lib/request-security';
import {milestoneAction,milestoneFilters} from '@/lib/project-milestone-input';
import {mutateMilestone,listMilestones} from '@/lib/project-milestones';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=milestoneAction.safeParse(await boundedBillingJson(request));if(!p.success)throw new BillingError('Invalid milestone request',400);return apiJson(await mutateMilestone(actor.id,p.data),{headers});}catch(e){return billingFailure(e);}}
export async function GET(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=milestoneFilters.safeParse(uniqueBillingQuery(request));if(!p.success)throw new BillingError('Invalid milestone filters',400);return apiJson(await listMilestones(actor.id,p.data),{headers});}catch(e){return billingFailure(e);}}
