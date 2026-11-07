import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, endMinute: z.number().int().min(1).max(1440),
  note: z.string().trim().max(1000).nullish() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid attendance update" }, { status: 400 });
  const { tenantId, endMinute, note } = parsed.data;
  const existing = await db.attendanceRecord.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true, startMinute: true, endMinute: true } });
  if (!existing) return NextResponse.json({ error: "Attendance record not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: existing.companyId,
    branchId: existing.branchId ?? undefined, permission: "attendance:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (endMinute <= existing.startMinute) return NextResponse.json({ error: "End time must follow start time" }, { status: 400 });
  const record = await db.$transaction(async (tx) => {
    const changed = await tx.attendanceRecord.updateMany({ where: { tenantId, id, endMinute: null },
      data: { endMinute, ...(note !== undefined ? { note: note ?? null } : {}) } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "attendance.completed",
      entity: "AttendanceRecord", entityId: id } });
    return tx.attendanceRecord.findUnique({ where: { id } });
  });
  if (!record) return NextResponse.json({ error: "Attendance already completed" }, { status: 409 });
  return NextResponse.json({ record });
}
