import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const updateSchema = z.object({
  tenantId: uuid,
  action: z.literal("update"),
  displayName: z.string().trim().min(2).max(160).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["tenantId", "action"].includes(key)));
const archiveSchema = z.object({
  tenantId: uuid, action: z.literal("archive"), archived: z.boolean(),
}).strict();
const schema = z.union([updateSchema, archiveSchema]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  const { tenantId } = parsed.data;
  const customer = await db.customer.findUnique({
    where: { tenantId_id: { tenantId, id } },
    select: { id: true, companyId: true, branchId: true, archivedAt: true },
  });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  const permission = parsed.data.action === "archive" ? "customer:archive" : "customer:update";
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: customer.companyId,
    branchId: customer.branchId ?? undefined, permission })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (parsed.data.action === "update" && customer.archivedAt)
    return NextResponse.json({ error: "Restore customer before editing" }, { status: 409 });
  const update = parsed.data.action === "archive"
    ? { archivedAt: parsed.data.archived ? new Date() : null }
    : { displayName: parsed.data.displayName, legalName: parsed.data.legalName,
      email: parsed.data.email, phone: parsed.data.phone, notes: parsed.data.notes };
  const result = await db.$transaction(async (tx) => {
    const result = await tx.customer.update({ where: { id }, data: update });
    await tx.auditLog.create({
      data: { tenantId, actorId: actor.id,
        action: parsed.data.action === "archive" ? (parsed.data.archived ? "customer.archived" : "customer.restored") : "customer.updated",
        entity: "Customer", entityId: id },
    });
    return result;
  });
  return NextResponse.json({ customer: result });
}
