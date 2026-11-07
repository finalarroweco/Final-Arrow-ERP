import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { dueDate } from "./date";

export const auditFilters = {
  tenantId: z.string().uuid(),
  action: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  actorId: z.union([z.string().uuid(), z.literal("SYSTEM")]).optional(),
  from: dueDate.optional(), to: dueDate.optional(),
  timeZone: z.enum(["UTC", "Asia/Muscat"]).default("UTC"),
};
export const auditFilterKeys = Object.keys(auditFilters);
export type AuditFilters = z.infer<z.ZodObject<typeof auditFilters>>;
export function auditWhere({ tenantId, action, entity, entityId, actorId, from, to, timeZone }: AuditFilters): Prisma.AuditLogWhereInput {
  const offset = timeZone === "Asia/Muscat" ? 14400000 : 0;
  return {
    tenantId,
    ...(action ? { action: { contains: action, mode: "insensitive" } } : {}),
    ...(entity ? { entity: { contains: entity, mode: "insensitive" } } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actorId ? { actorId: actorId === "SYSTEM" ? null : actorId } : {}),
    ...(from || to ? { createdAt: {
      ...(from ? { gte: new Date(Date.parse(`${from}T00:00:00Z`) - offset) } : {}),
      ...(to ? { lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000 - offset) } : {}),
    } } : {}),
  };
}
export async function auditRows(filters: AuditFilters, take: number, skip = 0) {
  const entries = await db.auditLog.findMany({ where: auditWhere(filters),
    select: { id: true, actorId: true, action: true, entity: true, entityId: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip, take });
  const actorIds = [...new Set(entries.flatMap(entry => entry.actorId ? [entry.actorId] : []))];
  const names = new Map((await db.user.findMany({ where: { id: { in: actorIds }, memberships: { some: { tenantId: filters.tenantId } } },
    select: { id: true, name: true } })).map(user => [user.id, user.name]));
  return entries.map(entry => ({ ...entry, actorName: entry.actorId ? names.get(entry.actorId) ?? null : null }));
}
