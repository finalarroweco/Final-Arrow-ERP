import { apiJson } from "@/lib/api-response";
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {approvalPolicyCommand,approvalSubmit,approvalVote} from '@/lib/approval-workflow-input';
import {mutateApproval} from '@/lib/approval-workflows';
import {approvalFailure,approvalResponse} from '@/lib/approval-workflow-route';
export async function POST(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401});const parsed=z.union([approvalPolicyCommand,approvalSubmit,approvalVote]).safeParse(await request.json().catch(()=>null));if(!parsed.success)return apiJson({error:'Invalid approval command'},{status:400});try{return approvalResponse({receipt:await mutateApproval(actor.id,parsed.data,true)});}catch(error){return approvalFailure(error);}}
