import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {canAccess} from "@/lib/access";
import {queryInput} from "@/lib/ledger";
import {uuid,OperationalError,operationalFailure} from "@/lib/operational-records";
import {timeReviewInput} from "@/lib/project-time-review-input";
async function projectScope(userId:string,tenantId:string,id:string,approve=false){
 if(!uuid.safeParse(id).success)throw new OperationalError("Invalid project",400);const project=await db.project.findUnique({where:{tenantId_id:{tenantId,id}},select:{companyId:true,branchId:true}});if(!project)throw new OperationalError("Project not found",404);
 for(const permission of ["project:read","project-time:read",...(approve?["project-time:approve"]:[])])if(!(await canAccess({userId,tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission})))throw new OperationalError("Forbidden",403);return project;
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=z.object({tenantId:uuid,entryId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","entryId","page"]));if(!p.success)return NextResponse.json({error:"Invalid review history filters"},{status:400});
 try{const {tenantId,entryId,page}=p.data,project=await projectScope(actor.id,tenantId,id);const entry=await db.projectTimeEntry.findFirst({where:{id:entryId,tenantId,companyId:project.companyId,projectId:id},select:{id:true}});if(!entry)throw new OperationalError("Time entry not found",404);
 const records=await db.projectTimeReview.findMany({where:{tenantId,projectId:id,entryId},orderBy:{sequence:"desc"},take:51,skip:page*50});const users=await db.user.findMany({where:{id:{in:records.slice(0,50).map(r=>r.createdBy)}},select:{id:true,name:true}}),names=new Map(users.map(u=>[u.id,u.name]));return NextResponse.json({reviews:records.slice(0,50).map(r=>({...r,reviewerName:names.get(r.createdBy)??null})),nextPage:records.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=timeReviewInput.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid time review"},{status:400});
 try{const {tenantId,requestId,entryId,expectedSequence,state,reason}=p.data,project=await projectScope(actor.id,tenantId,id,true);const result=await db.$transaction(async tx=>{
 const [source]=await tx.$queryRaw<{status:string}[]>`SELECT status FROM "Project" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 const existing=await tx.projectTimeReview.findUnique({where:{id:requestId}});if(existing){if(existing.tenantId!==tenantId||existing.projectId!==id||existing.entryId!==entryId||existing.createdBy!==actor.id||existing.sequence!==expectedSequence+1||existing.state!==state||existing.reason!==reason)throw new OperationalError("Review request ID already used");return {review:existing,replayed:true};}
 const entry=await tx.projectTimeEntry.findFirst({where:{id:entryId,tenantId,companyId:project.companyId,projectId:id}});if(!entry)throw new OperationalError("Time entry not found",404);
 if(!["PLANNED","ACTIVE","ON_HOLD"].includes(source.status)||entry.voidedAt||entry.reviewSequence!==expectedSequence)throw new OperationalError("Time review changed, source voided or project closed. Reload the entries.");
 if(!((entry.reviewState==="PENDING"&&state!=="PENDING")||(entry.reviewState!=="PENDING"&&state==="PENDING")))throw new OperationalError("Reset the current decision to pending before a new approval or rejection");
 const review=await tx.projectTimeReview.create({data:{id:requestId,tenantId,companyId:project.companyId,projectId:id,entryId,sequence:expectedSequence+1,state,reason,createdBy:actor.id}});const [clock]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
 await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"ProjectTimeReview",entityId:review.id,action:"project-time.reviewed",metadata:{parentId:id,entryId,state,version:review.sequence,transaction:clock.transaction}}});return {review,replayed:false};},{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});
 }catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
