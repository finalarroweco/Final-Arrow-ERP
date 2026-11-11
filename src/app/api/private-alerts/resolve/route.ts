import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {alertRequest} from '@/lib/private-alert-input';
import {AlertError,mutateAlert} from '@/lib/private-alerts';
import {alertBody,alertFailure,alertHeaders as headers} from '@/lib/private-alert-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=alertRequest.safeParse(await alertBody(request));if(!p.success)throw new AlertError('Invalid alert request',400);return NextResponse.json(await mutateAlert(actor.id,p.data,true),{headers});}catch(e){return alertFailure(e);}}
