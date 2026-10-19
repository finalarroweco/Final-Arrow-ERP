import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid,
  stage: z.enum(["NEW", "QUALIFIED", "PROPOSAL", "LOST"]).optional(),
  displayName: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== "tenantId"));

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid lead update" }, { status: 400 });
  const { tenantId, ...data } = parsed.data;
  const lead = await db.lead.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true, stage: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: lead.companyId,
    branchId: lead.branchId ?? undefined, permission: "lead:update" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (lead.stage === "WON") return NextResponse.json({ error: "Converted lead cannot be edited" }, { status: 409 });
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.lead.updateMany({ where: { id, tenantId, stage: { not: "WON" } }, data });
    if (!changed.count) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "lead.updated", entity: "Lead", entityId: id,
      metadata: { stage: data.stage ?? lead.stage } } });
    return tx.lead.findUnique({ where: { id } });
  });
  if (!result) return NextResponse.json({ error: "Converted lead cannot be edited" }, { status: 409 });
  return NextResponse.json({ lead: result });
}
