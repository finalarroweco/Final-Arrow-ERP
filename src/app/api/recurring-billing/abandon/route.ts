import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {recurringRequest} from '@/lib/recurring-input';
import {BillingError,mutateRecurringBilling} from '@/lib/recurring-billing';
import {boundedBillingJson,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=recurringRequest.safeParse(await boundedBillingJson(request));if(!p.success)throw new BillingError('Invalid exact recovery request',400);return NextResponse.json(await mutateRecurringBilling(actor.id,p.data,true),{headers});}catch(e){return billingFailure(e);}}
