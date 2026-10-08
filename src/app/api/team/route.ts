import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import {grantRevision} from "@/lib/role-management";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const tenantId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("tenantId"));
  if (!tenantId.success) return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  if (!(await canAccess({ userId: actor.id, tenantId: tenantId.data, permission: "user:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [memberships, invitations] = await Promise.all([
    db.membership.findMany({
      where: { tenantId: tenantId.data },
      include: { user: { select: { name: true, email: true } },
        roleGrants: { include: { role: { select: { id: true, name: true } }, scopes: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { tenantId: tenantId.data, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { role: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return NextResponse.json({
    members: memberships.map((membership) => ({
      id: membership.id, userId: membership.userId, name: membership.user.name,
      email: membership.user.email, status: membership.status, revision:grantRevision(membership.roleGrants),
      grants: membership.roleGrants.map((grant) => ({
        role: grant.role.name, roleId:grant.role.id,
        scopes: grant.scopes.map((scope) => ({
          type: scope.type, companyId: scope.companyId, branchId: scope.branchId,
        })),
      })),
    })),
    invitations: invitations.map((invitation) => ({
      id: invitation.id, email: invitation.email, role: invitation.role.name,
      type: invitation.type, companyId: invitation.companyId, branchId: invitation.branchId,
      expiresAt: invitation.expiresAt,
    })),
  },{headers:{"Cache-Control":"private, no-store"}});
}

