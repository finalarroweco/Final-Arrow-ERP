import {apiJson} from '@/lib/api-response';
import {currentAutomationActor} from '@/lib/automation-session';
import {apiMutationFailure} from '@/lib/request-security';
import {automationCommand,automationQuery} from '@/lib/automation-input';
import {AutomationError,listAutomation,mutateAutomation} from '@/lib/automation';
import {automationHeaders as headers,automationJson,automationFailure} from '@/lib/automation-route';
export async function GET(request:Request){const actor=await currentAutomationActor();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new AutomationError('Duplicate query parameter',400);const p=automationQuery.safeParse(Object.fromEntries(params));if(!p.success)throw new AutomationError('Invalid automation filters',400);return apiJson(await listAutomation(actor.id,p.data,actor.sessionId),{headers});}catch(e){return automationFailure(e);}}
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentAutomationActor();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=automationCommand.safeParse(await automationJson(request));if(!p.success)throw new AutomationError('Invalid automation command',400);return apiJson(await mutateAutomation(actor.id,p.data,false,actor.sessionId),{status:201,headers});}catch(e){return automationFailure(e);}}
