import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  number: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid sales order" }, { status: 400 });
  const { tenantId, number } = parsed.data;
  const quote = await db.quote.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: quote.companyId, branchId: quote.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "order:create" })) ||
    !(await canAccess({ ...scope, permission: "quote:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const order = await db.$transaction(async (tx) => {
      const source = await tx.quote.findUnique({ where: { tenantId_id: { tenantId, id } },
        include: { customer: { select: { displayName: true } }, lines: { orderBy: { position: "asc" } } } });
      if (!source || source.status !== "ACCEPTED") return null;
      const order = await tx.salesOrder.create({ data: { tenantId, companyId: source.companyId,
        branchId: source.branchId, customerId: source.customerId, quoteId: source.id,
        number, customerName: source.customer.displayName, currency: source.currency,
        subtotal: source.subtotal, notes: source.notes, createdBy: actor.id,
        lines: { create: source.lines.map((line) => ({ position: line.position,
          description: line.description, quantity: line.quantity,
          unitPrice: line.unitPrice, amount: line.amount })) } }, include: { lines: true } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "order.created",
        entity: "SalesOrder", entityId: order.id,
        metadata: { quoteId: source.id, subtotal: source.subtotal.toString(), currency: source.currency } } });
      return order;
    });
    if (!order) return NextResponse.json({ error: "Quote must be accepted" }, { status: 409 });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Quote already has an order or order number is in use" }, { status: 409 });
    throw error;
  }
}
