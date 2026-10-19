import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {RoleError,lockTenant,requireOwner,allowedPermissions,validatePermissions,protectedRoles,roleRevision,roleFailure} from "@/lib/role-management";
const uuid=z.string().uuid();
const body=z.object({tenantId:uuid,name:z.string().trim().min(2).max(80),permissions:z.array(z.string().min(1).max(80)).max(100)}).strict();

export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams,parsed=z.object({tenantId:uuid}).strict().safeParse(Object.fromEntries(params));if(!parsed.success||params.getAll("tenantId").length!==1)return NextResponse.json({error:"Invalid tenant"},{status:400});
 const tenantId=parsed.data.tenantId;if(!(await canAccess({userId:actor.id,tenantId,permission:"user:manage"}))&&!(await canAccess({userId:actor.id,tenantId,permission:"user:invite"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const result=await db.$transaction(async tx=>{const roles=await tx.role.findMany({where:{tenantId},orderBy:{name:"asc"},include:{permissions:{select:{permissionKey:true}},_count:{select:{grants:true,invitations:true}}}});return {roles:roles.map(r=>({id:r.id,name:r.name,permissions:r.permissions.map(p=>p.permissionKey).sort(),protected:protectedRoles.includes(r.name),assignable:r.name!=="Owner",revision:roleRevision(r),members:r._count.grants,invitations:r._count.invitations})),permissions:await allowedPermissions(tx,tenantId)};},{isolationLevel:"RepeatableRead"});
 return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const parsed=body.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid role"},{status:400});const {tenantId,name,permissions}=parsed.data;
 try{const role=await db.$transaction(async tx=>{await lockTenant(tx,tenantId);await requireOwner(tx,tenantId,actor.id);if(protectedRoles.some(n=>n.toLowerCase()===name.toLowerCase()))throw new RoleError("Built-in role names are reserved",400);if(await tx.role.count({where:{tenantId}})>=103)throw new RoleError("Organization has reached 100 custom roles");if(await tx.role.findFirst({where:{tenantId,name:{equals:name,mode:"insensitive"}}}))throw new RoleError("Role name is already in use");await validatePermissions(tx,tenantId,permissions);const role=await tx.role.create({data:{tenantId,name}});await tx.rolePermission.createMany({data:permissions.map(permissionKey=>({tenantId,roleId:role.id,permissionKey}))});await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"role.created",entity:"Role",entityId:role.id,metadata:{name,permissions}}});return role;},{timeout:15000,maxWait:10000});return NextResponse.json({role},{status:201});}catch(e){return roleFailure(e);}
}
