import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {recurringHistoryFilters} from '@/lib/recurring-input';
import {BillingError,recurringBillingHistory} from '@/lib/recurring-billing';
import {uniqueBillingQuery,billingFailure,billingHeaders as headers} from '@/lib/recurring-route';
export async function GET(request:Request){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=recurringHistoryFilters.safeParse(uniqueBillingQuery(request));if(!p.success)throw new BillingError('Invalid billing history filters',400);return NextResponse.json(await recurringBillingHistory(actor.id,p.data),{headers});}catch(e){return billingFailure(e);}}
