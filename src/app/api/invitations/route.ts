import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const schema = z.object({
  tenantId: z.string().uuid(),
  email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  role: z.enum(["Manager", "Viewer"]),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("TENANT") }).strict(),
    z.object({ type: z.literal("COMPANY"), companyId: z.string().uuid() }).strict(),
    z.object({ type: z.literal("BRANCH"), companyId: z.string().uuid(), branchId: z.string().uuid() }).strict(),
  ]),
});

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation" }, { status: 400 });
  const { tenantId, email, role: roleName, scope } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, permission: "user:invite" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const role = await db.role.findUnique({
    where: { tenantId_name: { tenantId, name: roleName } }, select: { id: true },
  });
  if (!role) return NextResponse.json({ error: "Role unavailable" }, { status: 400 });
  if (scope.type !== "TENANT") {
    const company = await db.company.findUnique({
      where: { tenantId_id: { tenantId, id: scope.companyId } }, select: { id: true },
    });
    if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (scope.type === "BRANCH") {
      const branch = await db.branch.findUnique({
        where: { tenantId_companyId_id: { tenantId, companyId: scope.companyId, id: scope.branchId } },
        select: { id: true },
      });
      if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    }
  }
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 86400_000);
  const invitation = await db.$transaction(async (tx) => {
    const invitation = await tx.invitation.create({
      data: {
        tenantId, email, roleId: role.id, type: scope.type,
        companyId: scope.type === "TENANT" ? null : scope.companyId,
        branchId: scope.type === "BRANCH" ? scope.branchId : null,
        tokenHash, expiresAt, createdBy: actor.id,
      },
    });
    await tx.auditLog.create({
      data: { tenantId, actorId: actor.id, action: "invitation.created", entity: "Invitation", entityId: invitation.id,
        metadata: { email, role: roleName, scope: scope.type } },
    });
    return invitation;
  });
  return NextResponse.json({ path: `/invite/${token}`, expiresAt: invitation.expiresAt }, { status: 201 });
}
