import {db} from "./db";
import {canAccess} from "./access";
import {uuid,OperationalError} from "./operational-records";
export async function dependencyProject(id:string,tenantId:string,userId:string,write=false){
 if(!uuid.safeParse(id).success)throw new OperationalError("Invalid project",400);
 const project=await db.project.findUnique({where:{tenantId_id:{tenantId,id}},select:{id:true,companyId:true,branchId:true,name:true,status:true}});if(!project)throw new OperationalError("Project not found",404);
 for(const permission of ["project:read","project-task:read",...(write?["project-task:manage"]:[])])if(!(await canAccess({userId,tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission})))throw new OperationalError("Forbidden",403);return project;
}
