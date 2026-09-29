import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid, companyId: uuid, branchId: uuid.nullish(), customerId: uuid,
  number: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(z.object({
    description: z.string().trim().min(2).max(300),
    quantity: z.number().int().min(1).max(100000),
    unitPrice: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/),
  }).strict()).min(1).max(50),
}).strict();

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId: tenantId.data,
    companyId: companyId.data, permission: "quote:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const quotes = await db.quote.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, number: true, status: true, currency: true, subtotal: true,
      notes: true, branchId: true, createdAt: true,
      customer: { select: { id: true, displayName: true } },
      lines: { select: { description: true, quantity: true, unitPrice: true, amount: true, position: true },
        orderBy: { position: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ quotes: quotes.slice(0, 50), nextPage: quotes.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid quote" }, { status: 400 });
  const { tenantId, companyId, branchId, customerId, number, notes, lines } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "quote:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } },
    select: { id: true, baseCurrency: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const customer = await db.customer.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: customerId } },
    select: { branchId: true, archivedAt: true } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  if (customer.archivedAt || (customer.branchId && customer.branchId !== branchId))
    return NextResponse.json({ error: "Customer is archived or outside quote scope" }, { status: 409 });
  const amounts = lines.map((line) => new Prisma.Decimal(line.unitPrice).mul(line.quantity));
  const subtotal = amounts.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
  if (subtotal.greaterThan("999999999999999.999"))
    return NextResponse.json({ error: "Quote total too large" }, { status: 400 });
  try {
    const quote = await db.$transaction(async (tx) => {
      const quote = await tx.quote.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        customerId, number, notes: notes ?? null, currency: company.baseCurrency, subtotal,
        createdBy: actor.id, lines: { create: lines.map((line, position) => ({ position,
          description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, amount: amounts[position] })) } },
        include: { lines: true } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "quote.created",
        entity: "Quote", entityId: quote.id, metadata: { customerId, subtotal: subtotal.toString(), currency: quote.currency } } });
      return quote;
    });
    return NextResponse.json({ quote }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Quote number already in use" }, { status: 409 });
    throw error;
  }
}
