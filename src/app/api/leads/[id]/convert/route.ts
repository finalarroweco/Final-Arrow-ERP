import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  customerCode: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid conversion" }, { status: 400 });
  const { tenantId, customerCode } = parsed.data;
  const lead = await db.lead.findUnique({ where: { tenantId_id: { tenantId, id } } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: lead.companyId, branchId: lead.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "lead:convert" })) ||
    !(await canAccess({ ...scope, permission: "customer:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (lead.stage === "WON" || lead.stage === "LOST")
    return NextResponse.json({ error: "Lead is closed" }, { status: 409 });
  try {
    const customer = await db.$transaction(async (tx) => {
      const changed = await tx.lead.updateMany({ where: { id, tenantId,
        stage: { in: ["NEW", "QUALIFIED", "PROPOSAL"] }, convertedCustomerId: null },
        data: { stage: "WON" } });
      if (changed.count !== 1) return null;
      const customer = await tx.customer.create({ data: { tenantId, companyId: lead.companyId,
        branchId: lead.branchId, code: customerCode, displayName: lead.displayName,
        email: lead.email, phone: lead.phone, notes: lead.notes, createdBy: actor.id } });
      await tx.lead.update({ where: { id }, data: { convertedCustomerId: customer.id, convertedAt: new Date() } });
      await tx.auditLog.createMany({ data: [
        { tenantId, actorId: actor.id, action: "lead.converted", entity: "Lead", entityId: id, metadata: { customerId: customer.id } },
        { tenantId, actorId: actor.id, action: "customer.created", entity: "Customer", entityId: customer.id, metadata: { leadId: id } },
      ] });
      return customer;
    });
    if (!customer) return NextResponse.json({ error: "Lead is closed" }, { status: 409 });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Customer code already in use" }, { status: 409 });
    throw error;
  }
}
