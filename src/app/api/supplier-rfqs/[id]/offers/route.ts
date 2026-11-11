import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {rfqOfferFilters,rfqOffersResponse} from '@/lib/supplier-rfq-input';
import {RfqError,listRfqOffers} from '@/lib/supplier-rfqs';
import {uniqueRfqQuery,rfqFailure,rfqHeaders as headers} from '@/lib/supplier-rfq-route';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const id=z.string().uuid().parse((await params).id),p=rfqOfferFilters.safeParse(uniqueRfqQuery(request));if(!p.success)throw new RfqError('Invalid comparison filters',400);if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)throw new RfqError('Signed-in user changed. Reload before reading.',403);return NextResponse.json(rfqOffersResponse.parse(await listRfqOffers(actor.id,id,p.data)),{headers});}catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:'Invalid RFQ identity or response'},{status:400,headers});return rfqFailure(e);}}
