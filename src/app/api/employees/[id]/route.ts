import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const updateSchema = z.object({ tenantId: uuid, action: z.literal("update"),
  fullName: z.string().trim().min(2).max(160).optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email().max(255).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  startDate: dueDate.nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["tenantId", "action"].includes(key)));
const statusSchema = z.object({ tenantId: uuid, action: z.literal("status"),
  status: z.enum(["ACTIVE", "INACTIVE"]) }).strict();
const schema = z.union([updateSchema, statusSchema]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid employee update" }, { status: 400 });
  const { tenantId } = parsed.data;
  const employee = await db.employee.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true, status: true } });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: employee.companyId,
    branchId: employee.branchId ?? undefined, permission: "employee:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (parsed.data.action === "update" && employee.status === "INACTIVE")
    return NextResponse.json({ error: "Reactivate employee before editing" }, { status: 409 });
  const update = parsed.data.action === "status" ? { status: parsed.data.status }
    : { fullName: parsed.data.fullName, jobTitle: parsed.data.jobTitle,
      email: parsed.data.email, phone: parsed.data.phone,
      startDate: parsed.data.startDate === undefined ? undefined : parsed.data.startDate === null
        ? null : new Date(`${parsed.data.startDate}T00:00:00.000Z`) };
  const result = await db.$transaction(async (tx) => {
    const changed = await tx.employee.updateMany({ where: { id, tenantId, status: employee.status }, data: update });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: parsed.data.action === "status" ? (parsed.data.status === "ACTIVE" ? "employee.activated" : "employee.deactivated") : "employee.updated",
      entity: "Employee", entityId: id } });
    return tx.employee.findUnique({ where: { id } });
  });
  if (!result) return NextResponse.json({ error: "Employee status changed" }, { status: 409 });
  return NextResponse.json({ employee: result });
}
