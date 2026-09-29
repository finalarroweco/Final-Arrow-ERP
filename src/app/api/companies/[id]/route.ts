import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(200).nullable(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid company settings" }, { status: 400 });
  const { tenantId, ...data } = parsed.data;
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { id: true, baseCurrency: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: id, permission: "company:update" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { tenantId_id: { tenantId, id } }, data });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "company.updated",
      entity: "Company", entityId: id,
      metadata: { previousCurrency: company.baseCurrency, baseCurrency: updated.baseCurrency } } });
    return updated;
  });
  return NextResponse.json({ company: result });
}
