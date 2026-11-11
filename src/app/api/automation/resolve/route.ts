import {apiJson} from '@/lib/api-response';
import {currentAutomationActor} from '@/lib/automation-session';
import {apiMutationFailure} from '@/lib/request-security';
import {automationCommand} from '@/lib/automation-input';
import {AutomationError,mutateAutomation} from '@/lib/automation';
import {automationHeaders as headers,automationJson,automationFailure} from '@/lib/automation-route';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentAutomationActor();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=automationCommand.safeParse(await automationJson(request));if(!p.success)throw new AutomationError('Invalid saved automation command',400);return apiJson(await mutateAutomation(actor.id,p.data,true,actor.sessionId),{headers});}catch(e){return automationFailure(e);}}
