import { apiJson } from "@/lib/api-response";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import {lockTenant,RoleError,roleFailure} from "@/lib/role-management";
import { db } from "@/lib/db";

const schema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const actor = await currentUser();
  if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
  const { membershipId } = await params;
  if (!z.string().uuid().safeParse(membershipId).success)
    return apiJson({ error: "Invalid member" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ error: "Invalid status" }, { status: 400 });
  const { tenantId, status } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, permission: "user:manage" })))
    return apiJson({ error: "Forbidden" }, { status: 403 });
  try {await db.$transaction(async (tx) => {
    await lockTenant(tx,tenantId);
    const membership=await tx.membership.findFirst({where:{tenantId,id:membershipId},include:{roleGrants:{include:{role:{select:{name:true}}}}}});
    if(!membership)throw new RoleError("Member not found",404);
    if(membership.userId===actor.id||membership.roleGrants.some(g=>g.role.name==="Owner"))throw new RoleError("Owner membership cannot be changed here",403);
    if(membership.status==="INVITED")throw new RoleError("Member has not joined");
    await tx.membership.update({where:{id:membership.id},data:{status}});
    await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:status==="SUSPENDED"?"member.suspended":"member.reactivated",entity:"Membership",entityId:membership.id}});
  });
  return apiJson({ status });
  }catch(error){return roleFailure(error);}
}

