import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const querySchema = z.object({ tenantId: z.string().uuid(),
  page: z.coerce.number().int().min(0).max(100000).default(0),
  action: z.string().trim().max(100).optional(), entity: z.string().trim().max(100).optional(),
  from: dueDate.optional(), to: dueDate.optional() }).refine((value) => !value.from || !value.to || value.from <= value.to);
export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const keys = ["tenantId", "page", "action", "entity", "from", "to"];
  if (keys.some((key) => query.getAll(key).length > 1)) return NextResponse.json({ error: "Duplicate audit parameter" }, { status: 400 });
  const parsed = querySchema.safeParse(Object.fromEntries(keys.filter((key) => query.has(key)).map((key) => [key, query.get(key)])));
  if (!parsed.success) return NextResponse.json({ error: "Invalid audit filters" }, { status: 400 });
  const { tenantId, page, action, entity, from, to } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, permission: "user:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await db.auditLog.findMany({ where: { tenantId,
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    ...(entity ? { entity: { contains: entity, mode: "insensitive" } } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00.000Z`) + 86400000) } : {}) } } : {}) },
    select: { id: true, actorId: true, action: true, entity: true, entityId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page * 50, take: 51 });
  const visible = entries.slice(0, 50);
  const actorIds = [...new Set(visible.map((entry) => entry.actorId).filter((id): id is string => !!id))];
  const users = await db.user.findMany({ where: { id: { in: actorIds }, memberships: { some: { tenantId } } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  return NextResponse.json({ entries: visible.map((entry) => ({ ...entry, actorName: entry.actorId ? names.get(entry.actorId) ?? null : null })),
    nextPage: entries.length > 50 ? page + 1 : null });
}
