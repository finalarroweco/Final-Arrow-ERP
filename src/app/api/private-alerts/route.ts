import { apiJson } from "@/lib/api-response";
import {currentUser} from '@/lib/auth';
import {alertRequest,alertQuery} from '@/lib/private-alert-input';
import {AlertError,mutateAlert,listAlerts} from '@/lib/private-alerts';
import {alertBody,alertParams,alertFailure,alertHeaders as headers} from '@/lib/private-alert-route';
import {apiMutationFailure} from '@/lib/request-security';
export async function POST(request:Request){const denied=apiMutationFailure(request);if(denied)return apiJson({error:denied.error},{status:denied.status,headers});const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=alertRequest.safeParse(await alertBody(request));if(!p.success)throw new AlertError('Invalid alert request',400);return apiJson(await mutateAlert(actor.id,p.data),{status:201,headers});}catch(e){return alertFailure(e);}}
export async function GET(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401,headers});try{const p=alertQuery.safeParse(alertParams(request));if(!p.success)throw new AlertError('Invalid alert filters',400);return apiJson(await listAlerts(actor.id,p.data),{headers});}catch(e){return alertFailure(e);}}
