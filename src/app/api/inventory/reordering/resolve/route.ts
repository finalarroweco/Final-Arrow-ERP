import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {reorderRequest} from '@/lib/stock-reorder-input';
import {ReorderError,mutateReorder} from '@/lib/stock-reorders';
import {boundedReorderJson,reorderFailure,reorderHeaders as headers} from '@/lib/stock-reorder-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=reorderRequest.safeParse(await boundedReorderJson(request));if(!p.success)throw new ReorderError('Invalid reorder policy request',400);return NextResponse.json(await mutateReorder(actor.id,p.data,true),{headers});}catch(e){return reorderFailure(e);}}
