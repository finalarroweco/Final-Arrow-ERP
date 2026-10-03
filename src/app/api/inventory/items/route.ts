import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid, companyId: uuid, branchId: uuid.nullish(),
  sku: z.string().trim().regex(/^[A-Z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(160),
  unit: z.string().trim().regex(/^[A-Za-z0-9-]{1,16}$/),
  description: z.string().trim().max(1000).nullish(),
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
    companyId: companyId.data, permission: "inventory-item:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const items = await db.inventoryItem.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    archivedAt: params.get("archived") === "true" ? { not: null } : null,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, sku: true, name: true, unit: true, description: true, branchId: true, archivedAt: true },
    orderBy: [{ name: "asc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ items: items.slice(0, 50), nextPage: items.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid inventory item" }, { status: 400 });
  const { tenantId, companyId, branchId, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "inventory-item:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  try {
    const item = await db.$transaction(async (tx) => {
      const item = await tx.inventoryItem.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        ...data, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "inventory-item.created",
        entity: "InventoryItem", entityId: item.id } });
      return item;
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "SKU already in use" }, { status: 409 });
    throw error;
  }
}
