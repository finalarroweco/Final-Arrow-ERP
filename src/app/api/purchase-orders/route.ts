import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid, companyId: uuid, branchId: uuid.nullish(), supplierId: uuid,
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
    companyId: companyId.data, permission: "purchase-order:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orders = await db.purchaseOrder.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, number: true, supplierId: true, supplierName: true, branchId: true,
      status: true, issuedAt: true, receivedAt: true, cancelledAt: true,
      currency: true, subtotal: true, notes: true, createdAt: true,
      receipt: { select: { id: true, branchId: true, createdAt: true } },
      lines: { select: { id: true, position: true, description: true, quantity: true, unitPrice: true, amount: true },
        orderBy: { position: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ orders: orders.slice(0, 50), nextPage: orders.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase order" }, { status: 400 });
  const { tenantId, companyId, branchId, supplierId, number, notes, lines } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "purchase-order:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } },
    select: { id: true, baseCurrency: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const supplier = await db.supplier.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: supplierId } },
    select: { displayName: true, branchId: true, archivedAt: true } });
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  if (supplier.archivedAt || (supplier.branchId && supplier.branchId !== branchId))
    return NextResponse.json({ error: "Supplier is archived or outside order scope" }, { status: 409 });
  const amounts = lines.map((line) => new Prisma.Decimal(line.unitPrice).mul(line.quantity));
  const subtotal = amounts.reduce((sum, amount) => sum.add(amount), new Prisma.Decimal(0));
  if (subtotal.greaterThan("999999999999999.999"))
    return NextResponse.json({ error: "Purchase order total too large" }, { status: 400 });
  try {
    const order = await db.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        supplierId, supplierName: supplier.displayName, number, notes: notes ?? null,
        currency: company.baseCurrency, subtotal, createdBy: actor.id,
        lines: { create: lines.map((line, position) => ({ position, description: line.description,
          quantity: line.quantity, unitPrice: line.unitPrice, amount: amounts[position] })) } }, include: { lines: true } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "purchase-order.created",
        entity: "PurchaseOrder", entityId: order.id,
        metadata: { supplierId, subtotal: subtotal.toString(), currency: order.currency } } });
      return order;
    });
    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Purchase order number already in use" }, { status: 409 });
    throw error;
  }
}
