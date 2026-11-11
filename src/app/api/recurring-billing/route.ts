import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {recurringRequest,recurringFilters} from '@/lib/recurring-input';
import {BillingError,mutateRecurringBilling,listRecurringBilling} from '@/lib/recurring-billing';
import {boundedBillingJson,uniqueBillingQuery,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=recurringRequest.safeParse(await boundedBillingJson(request));if(!p.success)throw new BillingError('Invalid recurring billing request',400);return NextResponse.json(await mutateRecurringBilling(actor.id,p.data),{status:201,headers});}catch(e){return billingFailure(e);}}
export async function GET(request:Request){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=recurringFilters.safeParse(uniqueBillingQuery(request));if(!p.success)throw new BillingError('Invalid billing filters',400);return NextResponse.json(await listRecurringBilling(actor.id,p.data),{headers});}catch(e){return billingFailure(e);}}
