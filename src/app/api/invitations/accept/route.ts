import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, currentUser, hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

const schema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(12).max(128).optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation" }, { status: 400 });
  const actor = await currentUser();
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invitation = await db.invitation.findUnique({ where: { tokenHash } });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date())
    return NextResponse.json({ error: "Invitation expired or used" }, { status: 410 });
  if (actor && actor.email !== invitation.email)
    return NextResponse.json({ error: "Sign in with the invited email" }, { status: 403 });
  if (!actor) {
    const existing = await db.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Sign in to accept this invitation" }, { status: 401 });
    if (!parsed.data.name || !parsed.data.password)
      return NextResponse.json({ error: "Name and password required" }, { status: 400 });
  }
  try {
    const userId = await db.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Invitation already used");
      const user = actor ?? await tx.user.create({
        data: { email: invitation.email, name: parsed.data.name!,
          passwordHash: await hashPassword(parsed.data.password!) },
      });
      let membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: invitation.tenantId, userId: user.id } },
      });
      if (membership?.status === "SUSPENDED") throw new Error("Membership suspended");
      if (!membership) membership = await tx.membership.create({
        data: { tenantId: invitation.tenantId, userId: user.id, status: "ACTIVE" },
      });
      const grant = await tx.roleGrant.create({
        data: { tenantId: invitation.tenantId, membershipId: membership.id, roleId: invitation.roleId },
      });
      await tx.accessScope.create({
        data: {
          tenantId: invitation.tenantId, grantId: grant.id, type: invitation.type,
          companyId: invitation.companyId, branchId: invitation.branchId,
        },
      });
      await tx.auditLog.create({
        data: { tenantId: invitation.tenantId, actorId: user.id, action: "invitation.accepted",
          entity: "Invitation", entityId: invitation.id },
      });
      return user.id;
    });
    if (!actor) await createSession(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && ["Invitation already used", "Membership suspended"].includes(error.message))
      return NextResponse.json({ error: error.message }, { status: 409 });
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Account already exists; sign in first" }, { status: 409 });
    throw error;
  }
}
