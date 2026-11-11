import { apiJson } from "@/lib/api-response";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const tenantId = z.string().uuid().safeParse(new URL(request.url).searchParams.get("tenantId"));
  if (!z.string().uuid().safeParse(id).success || !tenantId.success)
    return apiJson({ error: "Invalid invitation" }, { status: 400 });
  if (!(await canAccess({ userId: actor.id, tenantId: tenantId.data, permission: "user:manage" })))
    return apiJson({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.invitation.updateMany({
      where: { id, tenantId: tenantId.data, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (updated.count === 0) return false;
    await tx.auditLog.create({
      data: { tenantId: tenantId.data, actorId: actor.id, action: "invitation.revoked",
        entity: "Invitation", entityId: id },
    });
    return true;
  });
  if (!result) return apiJson({ error: "Invitation unavailable" }, { status: 404 });
  return apiJson({ ok: true });
}
