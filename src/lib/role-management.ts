import {createHash} from "node:crypto";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {NextResponse} from "next/server";
export const protectedRoles=["Owner","Manager","Viewer"];
export const scopeSchema=z.discriminatedUnion("type",[
 z.object({type:z.literal("TENANT")}).strict(),
 z.object({type:z.literal("COMPANY"),companyId:z.string().uuid()}).strict(),
 z.object({type:z.literal("BRANCH"),companyId:z.string().uuid(),branchId:z.string().uuid()}).strict(),
]);
export class RoleError extends Error{constructor(message:string,public status=409){super(message);}}
export const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function roleRevision(role:{name:string;permissions:{permissionKey:string}[]}){return digest([role.name,role.permissions.map(p=>p.permissionKey).sort()]);}
export function grantRevision(grants:{id:string;roleId:string;scopes:{type:string;companyId:string|null;branchId:string|null}[]}[]){return digest(grants.map(g=>[g.id,g.roleId,g.scopes.map(s=>[s.type,s.companyId,s.branchId]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));}
export async function lockTenant(tx:Prisma.TransactionClient,tenantId:string){await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;}
export async function requireOwner(tx:Prisma.TransactionClient,tenantId:string,userId:string){
 const member=await tx.membership.findFirst({where:{tenantId,userId,status:"ACTIVE",roleGrants:{some:{role:{name:"Owner"},scopes:{some:{type:"TENANT"}}}}},select:{id:true}});
 if(!member)throw new RoleError("Organization owner access is required",403);
}
export async function allowedPermissions(tx:Prisma.TransactionClient,tenantId:string){
 const owner=await tx.role.findUnique({where:{tenantId_name:{tenantId,name:"Owner"}},select:{permissions:{select:{permissionKey:true}}}});
 return (owner?.permissions??[]).map(p=>p.permissionKey).filter(k=>!k.startsWith("user:")&&k!=="company:create").sort();
}
export async function validatePermissions(tx:Prisma.TransactionClient,tenantId:string,keys:string[]){
 const available=await allowedPermissions(tx,tenantId),selected=new Set(keys);
 if(selected.size!==keys.length||keys.some(k=>!available.includes(k)))throw new RoleError("Unknown or reserved permission",400);
 for(const key of keys){const resource=key.split(":")[0],read=`${resource}:read`;if(available.includes(read)&&!selected.has(read))throw new RoleError(`Add ${read} before an action in this module`,400);}
 const linked:Record<string,string[]>={"ledger-account:manage":["ledger:read"],"ledger-period:manage":["ledger:read"],"project-task:read":["project:read"],"project-time:read":["project:read"]};
 for(const key of keys)if(linked[key]?.some(k=>!selected.has(k)))throw new RoleError(`Required read permissions are missing for ${key}`,400);
}
export async function validateScope(tx:Prisma.TransactionClient,tenantId:string,scope:z.infer<typeof scopeSchema>){
 if(scope.type==="TENANT")return;
 if(!(await tx.company.findFirst({where:{tenantId,id:scope.companyId},select:{id:true}})))throw new RoleError("Company not found",404);
 if(scope.type==="BRANCH"&&!(await tx.branch.findFirst({where:{tenantId,companyId:scope.companyId,id:scope.branchId},select:{id:true}})))throw new RoleError("Branch not found in this company",404);
}
export async function assignableRole(tx:Prisma.TransactionClient,tenantId:string,roleId:string){
 const role=await tx.role.findFirst({where:{tenantId,id:roleId},select:{id:true,name:true}});
 if(!role)throw new RoleError("Role not found",404);
 if(role.name==="Owner")throw new RoleError("Owner role cannot be delegated here",403);
 return role;
}

export function roleFailure(error:unknown){if(error instanceof RoleError)return NextResponse.json({error:error.message},{status:error.status});if(error instanceof Error&&"code" in error&&error.code==="P2002")return NextResponse.json({error:"Role name is already in use"},{status:409});throw error;}
