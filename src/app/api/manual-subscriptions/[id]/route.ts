import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {subscriptionDetailFilters} from '@/lib/manual-subscription-input';
import {SubscriptionError,readManualSubscription} from '@/lib/manual-subscriptions';
import {uniqueSubscriptionQuery,subscriptionFailure,subscriptionHeaders as headers} from '@/lib/manual-subscription-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=subscriptionDetailFilters.safeParse(uniqueSubscriptionQuery(request)),id=z.string().uuid().safeParse((await params).id);if(!p.success||!id.success)throw new SubscriptionError('Invalid subscription detail filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new SubscriptionError('Signed-in user changed. Reload before reading.',403);return NextResponse.json(await readManualSubscription(actor.id,id.data,p.data,p.data.page),{headers});}catch(e){return subscriptionFailure(e);}}
