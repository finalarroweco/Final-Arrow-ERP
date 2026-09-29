import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid,
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(z.object({
    description: z.string().trim().min(2).max(300),
    quantity: z.number().int().min(1).max(100000),
    unitPrice: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/),
  }).strict()).min(1).max(50),
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid quote update" }, { status: 400 });
  const { tenantId, notes, lines } = parsed.data;
  const quote = await db.quote.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!quote) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: quote.companyId,
    branchId: quote.branchId ?? undefined, permission: "quote:update" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const amounts = lines.map((line) => new Prisma.Decimal(line.unitPrice).mul(line.quantity));
  const subtotal = amounts.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
  if (subtotal.greaterThan("999999999999999.999"))
    return NextResponse.json({ error: "Quote total too large" }, { status: 400 });
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.quote.updateMany({ where: { id, tenantId, status: "DRAFT" },
      data: { notes: notes ?? null, subtotal } });
    if (changed.count !== 1) return null;
    await tx.quoteLine.deleteMany({ where: { tenantId, quoteId: id } });
    await tx.quoteLine.createMany({ data: lines.map((line, position) => ({ tenantId, quoteId: id,
      position, description: line.description, quantity: line.quantity,
      unitPrice: line.unitPrice, amount: amounts[position] })) });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "quote.updated",
      entity: "Quote", entityId: id, metadata: { subtotal: subtotal.toString(), lineCount: lines.length } } });
    return tx.quote.findUnique({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  });
  if (!result) return NextResponse.json({ error: "Only draft quotes can be edited" }, { status: 409 });
  return NextResponse.json({ quote: result });
}
