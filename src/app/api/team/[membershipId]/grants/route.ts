import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {RoleError,lockTenant,requireOwner,validateScope,assignableRole,scopeSchema,grantRevision} from "@/lib/role-management";
import {roleFailure} from "@/lib/role-management";
const schema=z.object({tenantId:z.string().uuid(),expectedRevision:z.string().regex(/^[a-f0-9]{64}$/),grants:z.array(z.object({roleId:z.string().uuid(),scope:scopeSchema}).strict()).min(1).max(10)}).strict();
export async function PATCH(request:Request,{params}:{params:Promise<{membershipId:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {membershipId}=await params,parsed=schema.safeParse(await request.json().catch(()=>null));if(!z.string().uuid().safeParse(membershipId).success||!parsed.success)return NextResponse.json({error:"Invalid role assignment"},{status:400});const {tenantId,expectedRevision,grants}=parsed.data;
 try{await db.$transaction(async tx=>{await lockTenant(tx,tenantId);await requireOwner(tx,tenantId,actor.id);const member=await tx.membership.findFirst({where:{tenantId,id:membershipId},include:{user:{select:{email:true}},roleGrants:{include:{scopes:true,role:{select:{name:true}}}}}});if(!member)throw new RoleError("Member not found",404);if(member.userId===actor.id||member.roleGrants.some(g=>g.role.name==="Owner"))throw new RoleError("Owner and own access cannot be changed here",403);if(member.status==="INVITED")throw new RoleError("Member has not joined");if(grantRevision(member.roleGrants)!==expectedRevision)throw new RoleError("Member access changed. Refresh before saving again");const keys=grants.map(g=>JSON.stringify([g.roleId,g.scope.type,g.scope.type!=="TENANT"?g.scope.companyId:null,g.scope.type==="BRANCH"?g.scope.branchId:null]));if(new Set(keys).size!==keys.length)throw new RoleError("Duplicate role and scope",400);
 for(const g of grants){await assignableRole(tx,tenantId,g.roleId);await validateScope(tx,tenantId,g.scope);}
 await tx.roleGrant.deleteMany({where:{tenantId,membershipId}});
 for(const g of grants){await tx.roleGrant.create({data:{tenantId,membershipId,roleId:g.roleId,scopes:{create:{type:g.scope.type,companyId:g.scope.type!=="TENANT"?g.scope.companyId:null,branchId:g.scope.type==="BRANCH"?g.scope.branchId:null}}}});}
 const revoked=await tx.invitation.updateMany({where:{tenantId,email:member.user.email,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
 await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"member.access_updated",entity:"Membership",entityId:member.id,metadata:{before:member.roleGrants.map(g=>({roleId:g.roleId,scopes:g.scopes.map(s=>({type:s.type,companyId:s.companyId,branchId:s.branchId}))})),after:grants,revokedPendingInvitations:revoked.count}}});});return NextResponse.json({ok:true});}catch(e){return roleFailure(e);}
}
