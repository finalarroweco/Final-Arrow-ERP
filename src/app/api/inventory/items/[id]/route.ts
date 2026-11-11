import { apiJson } from "@/lib/api-response";
import {Prisma} from "@prisma/client";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const updateSchema = z.object({ tenantId: uuid, action: z.literal("update"),
  name: z.string().trim().min(2).max(160).optional(),
  unit: z.string().trim().regex(/^[A-Za-z0-9-]{1,16}$/).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["tenantId", "action"].includes(key)));
const archiveSchema = z.object({ tenantId: uuid, action: z.literal("archive"), archived: z.boolean() }).strict();
const schema = z.union([updateSchema, archiveSchema]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return apiJson({ error: "Invalid inventory item update" }, { status: 400 });
  const { tenantId } = parsed.data;
  const item = await db.inventoryItem.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true, archivedAt: true } });
  if (!item) return apiJson({ error: "Inventory item not found" }, { status: 404 });
  const permission = parsed.data.action === "archive" ? "inventory-item:archive" : "inventory-item:update";
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: item.companyId,
    branchId: item.branchId ?? undefined, permission })))
    return apiJson({ error: "Forbidden" }, { status: 403 });
  if (parsed.data.action === "update" && item.archivedAt)
    return apiJson({ error: "Restore item before editing" }, { status: 409 });
  const update = parsed.data.action === "archive"
    ? { archivedAt: parsed.data.archived ? new Date() : null }
    : { name: parsed.data.name, unit: parsed.data.unit, description: parsed.data.description };
  try {const result = await db.$transaction(async (tx) => {
    const result = await tx.inventoryItem.update({ where: { id }, data: update });
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: parsed.data.action === "archive" ? (parsed.data.archived ? "inventory-item.archived" : "inventory-item.restored") : "inventory-item.updated",
      entity: "InventoryItem", entityId: id } });
    return result;
  });
  return apiJson({ item: result });
  }catch(error){if((error instanceof Prisma.PrismaClientKnownRequestError&&["P2004","P2010"].includes(error.code))||(error instanceof Prisma.PrismaClientUnknownRequestError&&error.message.includes('code: "23514"')))return apiJson({error:"Release active order-linked holds before changing the stock unit. Existing hold snapshots never change; no unit conversion is performed."},{status:409});throw error;}
}
