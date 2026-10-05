import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const amountSchema = z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
const schema = z.object({ tenantId: uuid, companyId: uuid, branchId: uuid, itemId: uuid,
  action: z.enum(["in", "out"]), quantity: amountSchema,
  reason: z.string().trim().min(3).max(200) }).strict();
class StockConflict extends Error {}

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const branchId = uuid.safeParse(params.get("branchId"));
  if (!tenantId.success || !companyId.success || !branchId.success)
    return NextResponse.json({ error: "Invalid branch scope" }, { status: 400 });
  if (!(await canAccess({ userId: actor.id, tenantId: tenantId.data, companyId: companyId.data,
    branchId: branchId.data, permission: "inventory-stock:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const where = { tenantId: tenantId.data, companyId: companyId.data, branchId: branchId.data };
  const [items, balances, movements] = await Promise.all([
    db.inventoryItem.findMany({ where: { tenantId: where.tenantId, companyId: where.companyId,
      branchId: { in: [where.branchId] }, archivedAt: null },
      select: { id: true, sku: true, name: true, unit: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 200 }),
    db.stockBalance.findMany({ where, select: { itemId: true, quantity: true,
      item: { select: { sku: true, name: true, unit: true, archivedAt: true } } }, orderBy: { item: { name: "asc" } } }),
    db.stockMovement.findMany({ where: { tenantId: where.tenantId, balance: where },
      select: { id: true, type: true, delta: true, reason: true, createdAt: true,
        balance: { select: { item: { select: { sku: true, name: true, unit: true } } } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 }),
  ]);
  // Include company-wide items in branch stock operations, even for branch-only users.
  const sharedItems = await db.inventoryItem.findMany({ where: { tenantId: where.tenantId,
    companyId: where.companyId, branchId: null, archivedAt: null },
    select: { id: true, sku: true, name: true, unit: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 200 });
  const reversalEvents = await db.auditLog.findMany({ where: { tenantId: where.tenantId,
    entity: "StockMovement", entityId: { in: movements.map(movement => movement.id) },
    action: { in: ["inventory-stock.reversed", "inventory-stock.reversal-created"] } },
    select: { entityId: true, action: true } });
  const decorated = movements.map(movement => ({ ...movement,
    reversed: reversalEvents.some(event => event.entityId === movement.id && event.action === "inventory-stock.reversed"),
    isReversal: reversalEvents.some(event => event.entityId === movement.id && event.action === "inventory-stock.reversal-created"),
  }));
  return NextResponse.json({ items: [...items, ...sharedItems].sort((a, b) => a.name.localeCompare(b.name)),
    balances, movements: decorated }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid stock adjustment" }, { status: 400 });
  const { tenantId, companyId, branchId, itemId, action, quantity, reason } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId,
    permission: "inventory-stock:adjust" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const branch = await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  const item = await db.inventoryItem.findUnique({ where: { tenantId_id: { tenantId, id: itemId } },
    select: { companyId: true, branchId: true, archivedAt: true } });
  if (!item || item.companyId !== companyId) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (item.archivedAt || (item.branchId && item.branchId !== branchId))
    return NextResponse.json({ error: "Item is archived or outside branch scope" }, { status: 409 });
  const amount = new Prisma.Decimal(quantity);
  const delta = action === "in" ? amount : amount.neg();
  const max = new Prisma.Decimal("999999999999999.999");
  try {
    const result = await db.$transaction(async (tx) => {
    const balance = await tx.stockBalance.upsert({ where: { tenantId_companyId_branchId_itemId: {
      tenantId, companyId, branchId, itemId } }, create: { tenantId, companyId, branchId, itemId }, update: {} });
    const changed = await tx.stockBalance.updateMany({ where: { id: balance.id,
      quantity: action === "out" ? { gte: amount } : { lte: max.sub(amount) } },
      data: { quantity: { increment: delta } } });
    if (changed.count !== 1) throw new StockConflict();
    const movement = await tx.stockMovement.create({ data: { tenantId, balanceId: balance.id,
      type: action === "in" ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT", delta, reason, actorId: actor.id } });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `inventory-stock.adjusted-${action}`,
      entity: "StockBalance", entityId: balance.id,
      metadata: { branchId, itemId, movementId: movement.id, delta: delta.toString(), reason } } });
    return tx.stockBalance.findUnique({ where: { id: balance.id }, select: { itemId: true, quantity: true } });
    });
    return NextResponse.json({ balance: result }, { status: 201 });
  } catch (error) {
    if (error instanceof StockConflict)
      return NextResponse.json({ error: "Insufficient stock or balance limit reached" }, { status: 409 });
    throw error;
  }
}
