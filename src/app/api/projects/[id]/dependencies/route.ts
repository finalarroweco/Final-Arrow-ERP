import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import {uuid,OperationalError,operationalFailure,operationalAudit} from "@/lib/operational-records";
import {dependencyProject} from "@/lib/task-dependency";
const input=z.discriminatedUnion("action",[z.object({tenantId:uuid,action:z.literal("add"),requestId:uuid,taskId:uuid,dependsOnId:uuid}).strict(),z.object({tenantId:uuid,action:z.literal("remove"),dependencyId:uuid}).strict()]);
function failure(e:unknown){if(e instanceof Error&&e.message.includes("Dependency cycle is not allowed"))return {error:"Dependency cycle is not allowed",status:409};return operationalFailure(e);}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),removed:z.enum(["true","false"]).default("false")}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","page","removed"]));if(!p.success)return NextResponse.json({error:"Invalid dependency filters"},{status:400});
 try{const {tenantId,page,removed}=p.data;await dependencyProject(id,tenantId,actor.id);const records=await db.projectTaskDependency.findMany({where:{tenantId,projectId:id,removedAt:removed==="true"?{not:null}:null},include:{task:{select:{id:true,title:true,status:true}},dependsOn:{select:{id:true,title:true,status:true}}},orderBy:[{createdAt:"desc"},{id:"desc"}],take:51,skip:page*50});return NextResponse.json({dependencies:records.slice(0,50).map(d=>({...d,blocked:!d.removedAt&&d.dependsOn.status!=="DONE"})),nextPage:records.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}catch(e){const f=failure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=input.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid dependency action"},{status:400});
 try{const {tenantId}=p.data,project=await dependencyProject(id,tenantId,actor.id,true),result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 if(p.data.action==="add"){
 const {requestId,taskId,dependsOnId}=p.data,existing=await tx.projectTaskDependency.findUnique({where:{id:requestId}});if(existing){if(existing.tenantId!==tenantId||existing.projectId!==id||existing.taskId!==taskId||existing.dependsOnId!==dependsOnId||existing.createdBy!==actor.id)throw new OperationalError("Dependency request ID already used");return {dependency:existing,replayed:true};}
 const dependency=await tx.projectTaskDependency.create({data:{id:requestId,tenantId,companyId:project.companyId,projectId:id,taskId,dependsOnId,createdBy:actor.id}});await operationalAudit(tx,tenantId,actor.id,"ProjectTaskDependency",dependency.id,"project-task.dependency-added",id);return {dependency,replayed:false};
 }
 const existing=await tx.projectTaskDependency.findFirst({where:{id:p.data.dependencyId,tenantId,projectId:id}});if(!existing)throw new OperationalError("Dependency not found",404);if(existing.removedAt)return {dependency:existing,replayed:true};const dependency=await tx.projectTaskDependency.update({where:{id:existing.id},data:{removedAt:new Date(),removedBy:actor.id}});await operationalAudit(tx,tenantId,actor.id,"ProjectTaskDependency",dependency.id,"project-task.dependency-removed",id,2);return {dependency,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(e){const f=failure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
