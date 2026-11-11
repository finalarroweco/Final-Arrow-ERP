import {approvalSessionHash} from '@/lib/approval-session';
import {apiJson} from '@/lib/api-response';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {approvalFilters} from '@/lib/approval-workflow-input';
import {listApprovalRequests,readApprovalRequest} from '@/lib/approval-workflows';
import {approvalFailure,approvalResponse,approvalQuery} from '@/lib/approval-workflow-route';
const filters=approvalFilters.extend({approvalId:z.string().uuid().optional()}).strict();
export async function GET(request:Request){const actor=await currentUser();if(!actor)return apiJson({error:'Unauthenticated'},{status:401});const p=filters.safeParse(approvalQuery(request));if(!p.success)return apiJson({error:'Invalid scope'},{status:400});const scope={...p.data,branchId:p.data.branchId==='company'?null:p.data.branchId};try{return approvalResponse(p.data.approvalId?await readApprovalRequest(actor.id,scope,p.data.approvalId,p.data.page,await approvalSessionHash()):await listApprovalRequests(actor.id,scope,p.data.page,await approvalSessionHash()));}catch(error){return approvalFailure(error);}}
