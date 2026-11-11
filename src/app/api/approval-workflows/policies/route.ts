import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentUser} from '@/lib/auth';
import {approvalFilters} from '@/lib/approval-workflow-input';
import {listApprovalPolicies} from '@/lib/approval-workflows';
import {approvalFailure,approvalResponse,approvalQuery} from '@/lib/approval-workflow-route';
const filters=approvalFilters.extend({policyId:z.string().uuid().optional()}).strict();
export async function GET(request:Request){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401});const p=filters.safeParse(approvalQuery(request));if(!p.success)return NextResponse.json({error:'Invalid scope'},{status:400});try{return approvalResponse(await listApprovalPolicies(actor.id,{...p.data,branchId:p.data.branchId==='company'?null:p.data.branchId},p.data.page,p.data.policyId));}catch(error){return approvalFailure(error);}}
