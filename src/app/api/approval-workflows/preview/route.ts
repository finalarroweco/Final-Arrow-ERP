import {NextResponse} from 'next/server';
import {currentUser} from '@/lib/auth';
import {approvalSourceQuery} from '@/lib/approval-workflow-input';
import {previewApproval} from '@/lib/approval-workflows';
import {approvalFailure,approvalResponse,approvalQuery} from '@/lib/approval-workflow-route';
export async function GET(request:Request){const actor=await currentUser();if(!actor)return NextResponse.json({error:'Unauthenticated'},{status:401});const p=approvalSourceQuery.safeParse(approvalQuery(request));if(!p.success)return NextResponse.json({error:'Invalid source scope'},{status:400});try{return approvalResponse(await previewApproval(actor.id,{...p.data,branchId:p.data.branchId==='company'?null:p.data.branchId},p.data.resource,p.data.sourceId));}catch(error){return approvalFailure(error);}}
