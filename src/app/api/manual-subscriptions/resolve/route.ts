import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {subscriptionRequest} from '@/lib/manual-subscription-input';
import {SubscriptionError,mutateManualSubscription} from '@/lib/manual-subscriptions';
import {boundedSubscriptionJson,subscriptionFailure,subscriptionHeaders as headers} from '@/lib/manual-subscription-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=subscriptionRequest.safeParse(await boundedSubscriptionJson(request));if(!p.success)throw new SubscriptionError('Invalid subscription request',400);return apiJson(await mutateManualSubscription(actor.id,p.data,true),{headers});}catch(e){return subscriptionFailure(e);}}
