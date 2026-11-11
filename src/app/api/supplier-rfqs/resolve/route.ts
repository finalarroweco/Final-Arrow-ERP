import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {rfqRequest} from '@/lib/supplier-rfq-input';
import {RfqError,mutateRfq} from '@/lib/supplier-rfqs';
import {boundedRfqJson,rfqFailure,rfqHeaders as headers} from '@/lib/supplier-rfq-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=rfqRequest.safeParse(await boundedRfqJson(request));if(!p.success)throw new RfqError('Invalid RFQ request',400);return NextResponse.json(await mutateRfq(actor.id,p.data,true),{headers});}catch(e){return rfqFailure(e);}}
