import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  action: z.enum(["send", "accept", "reject"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid quote action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const quote = await db.quote.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: quote.companyId,
    branchId: quote.branchId ?? undefined, permission: action === "send" ? "quote:send" : "quote:decide" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = action === "send" ? "SENT" : action === "accept" ? "ACCEPTED" : "REJECTED";
  const expected = action === "send" ? "DRAFT" : "SENT";
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.quote.updateMany({ where: { id, tenantId, status: expected },
      data: { status, ...(action === "send" ? { sentAt: new Date() } : { decidedAt: new Date() }) } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `quote.${action === "send" ? "sent" : action === "accept" ? "accepted" : "rejected"}`,
      entity: "Quote", entityId: id, metadata: { from: expected, to: status } } });
    return tx.quote.findUnique({ where: { id }, select: { id: true, status: true, sentAt: true, decidedAt: true } });
  });
  if (!result) return NextResponse.json({ error: "Quote status has changed or transition is invalid" }, { status: 409 });
  return NextResponse.json({ quote: result });
}
