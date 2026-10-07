import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {RoleError,lockTenant,requireOwner,scopeSchema,grantRevision} from "@/lib/role-management";
import {roleFailure} from "@/lib/role-management";
const schema=z.object({tenantId:z.string().uuid(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),grants:z.array(z.object({roleId:z.string().uuid(),scope:scopeSchema}).strict()).min(1).max(10)}).strict();
export async function PATCH(request:Request,{params}:{params:Promise<{membershipId:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {membershipId}=await params,parsed=schema.safeParse(await request.json().catch(()=>null));if(!z.string().uuid().safeParse(membershipId).success||!parsed.success)return NextResponse.json({error:"Invalid role assignment"},{status:400});const {tenantId,expectedRevision,grants}=parsed.data;
 try{await db.$transaction(async tx=>{await lockTenant(tx,tenantId);await requireOwner(tx,tenantId,actor.id);const member=await tx.membership.findFirst({where:{tenantId,id:membershipId},include:{user:{select:{email:true}},roleGrants:{include:{scopes:true,role:{select:{name:true}}}}}});if(!member)throw new RoleError("Member not found",404);if(member.userId===actor.id||member.roleGrants.some(g=>g.role.name==="Owner"))throw new RoleError("Owner and own access cannot be changed here",403);if(member.status==="INVITED")throw new RoleError("Member has not joined");if(grantRevision(member.roleGrants)!==expectedRevision)throw new RoleError("Member access changed. Refresh before saving again");const keys=grants.map(g=>JSON.stringify([g.roleId,g.scope.type,g.scope.type!=="TENANT"?g.scope.companyId:null,g.scope.type==="BRANCH"?g.scope.branchId:null]));if(new Set(keys).size!==keys.length)throw new RoleError("Duplicate role and scope",400);
 const roleIds=[...new Set(grants.map(g=>g.roleId))];
 const roles=await tx.role.findMany({where:{tenantId,id:{in:roleIds}},select:{id:true,name:true}});
 if(roles.length!==roleIds.length)throw new RoleError("Role not found",404);
 if(roles.some(r=>r.name==="Owner"))throw new RoleError("Owner role cannot be delegated here",403);
 const companyIds=[...new Set(grants.flatMap(g=>g.scope.type==="TENANT"?[]:[g.scope.companyId]))];
 const companies=await tx.company.findMany({where:{tenantId,id:{in:companyIds}},select:{id:true}});
 if(companies.length!==companyIds.length)throw new RoleError("Company not found",404);
 const branchScopes=grants.filter(g=>g.scope.type==="BRANCH").map(g=>g.scope).filter((s):s is Extract<typeof s,{type:"BRANCH"}>=>s.type==="BRANCH");
 const branches=await tx.branch.findMany({where:{tenantId,id:{in:branchScopes.map(s=>s.branchId)}},select:{id:true,companyId:true}});
 if(branchScopes.some(s=>!branches.some(b=>b.id===s.branchId&&b.companyId===s.companyId)))throw new RoleError("Branch not found in this company",404);
 await tx.roleGrant.deleteMany({where:{tenantId,membershipId}});
 const replacements=grants.map(g=>({...g,id:randomUUID()}));
 await tx.roleGrant.createMany({data:replacements.map(g=>({id:g.id,tenantId,membershipId,roleId:g.roleId}))});
 await tx.accessScope.createMany({data:replacements.map(g=>({tenantId,grantId:g.id,type:g.scope.type,companyId:g.scope.type!=="TENANT"?g.scope.companyId:null,branchId:g.scope.type==="BRANCH"?g.scope.branchId:null}))});
 const revoked=await tx.invitation.updateMany({where:{tenantId,email:member.user.email,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
 await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"member.access_updated",entity:"Membership",entityId:member.id,metadata:{before:member.roleGrants.map(g=>({roleId:g.roleId,scopes:g.scopes.map(s=>({type:s.type,companyId:s.companyId,branchId:s.branchId}))})),after:grants,revokedPendingInvitations:revoked.count}}});},{timeout:15000,maxWait:10000});return NextResponse.json({ok:true});}catch(e){return roleFailure(e);}
}
