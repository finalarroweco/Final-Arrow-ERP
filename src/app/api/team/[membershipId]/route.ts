import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const schema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { membershipId } = await params;
  if (!z.string().uuid().safeParse(membershipId).success)
    return NextResponse.json({ error: "Invalid member" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  const { tenantId, status } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, permission: "user:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const membership = await db.membership.findUnique({
    where: { tenantId_id: { tenantId, id: membershipId } },
    include: { roleGrants: { include: { role: { select: { name: true } } } } },
  });
  if (!membership) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (membership.userId === actor.id || membership.roleGrants.some((grant) => grant.role.name === "Owner"))
    return NextResponse.json({ error: "Owner membership cannot be changed here" }, { status: 403 });
  if (membership.status === "INVITED")
    return NextResponse.json({ error: "Member has not joined" }, { status: 409 });
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membership.id }, data: { status } });
    await tx.auditLog.create({
      data: { tenantId, actorId: actor.id, action: status === "SUSPENDED" ? "member.suspended" : "member.reactivated",
        entity: "Membership", entityId: membership.id },
    });
  });
  return NextResponse.json({ status });
}
