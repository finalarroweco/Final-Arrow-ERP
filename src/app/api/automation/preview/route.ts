import {NextResponse} from 'next/server';
import {currentAutomationActor} from '@/lib/automation-session';
import {apiMutationFailure} from '@/lib/request-security';
import {automationPreview} from '@/lib/automation-input';
import {AutomationError,automationSourcePreview} from '@/lib/automation';
import {automationHeaders as headers,automationJson,automationFailure} from '@/lib/automation-route';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return NextResponse.json({error:denied.error},{status:denied.status,headers});const actor=await currentAutomationActor();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401,headers});try{const p=automationPreview.safeParse(await automationJson(request));if(!p.success)throw new AutomationError('Invalid source scope',400);return NextResponse.json(await automationSourcePreview(actor.id,p.data,actor.sessionId),{headers});}catch(e){return automationFailure(e);}}
