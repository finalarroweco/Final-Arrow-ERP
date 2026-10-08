import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const updateSchema = z.object({ tenantId: uuid, action: z.literal("update"),
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  dueDate: dueDate.nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => !["tenantId", "action"].includes(key)));
const transitionSchema = z.object({ tenantId: uuid, action: z.enum(["activate", "pause", "complete", "cancel"]) }).strict();
const schema = z.union([updateSchema, transitionSchema]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid project update" }, { status: 400 });
  const { tenantId } = parsed.data;
  const project = await db.project.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: project.companyId,
    branchId: project.branchId ?? undefined, permission: "project:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const action = parsed.data.action;
  const transitions = { activate: { from: ["PLANNED", "ON_HOLD"], to: "ACTIVE" },
    pause: { from: ["ACTIVE"], to: "ON_HOLD" },
    complete: { from: ["ACTIVE"], to: "COMPLETED" },
    cancel: { from: ["PLANNED", "ACTIVE", "ON_HOLD"], to: "CANCELLED" } } as const;
  const result = await db.$transaction(async (tx) => {
    const changed = action === "update"
      ? await tx.project.updateMany({ where: { id, tenantId, status: { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } },
        data: { name: parsed.data.name, description: parsed.data.description,
          dueDate: parsed.data.dueDate === undefined ? undefined : parsed.data.dueDate === null
            ? null : new Date(`${parsed.data.dueDate}T00:00:00.000Z`) } })
      : await tx.project.updateMany({ where: { id, tenantId,
        status: { in: [...transitions[action].from] },
        ...(action === "complete" ? { tasks: { none: { status: { in: ["TODO", "IN_PROGRESS"] } } } } : {}) },
        data: { status: transitions[action].to } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: action === "update" ? "project.updated" : `project.${action === "activate" ? "activated" : action === "pause" ? "paused" : action === "complete" ? "completed" : "cancelled"}`,
      entity: "Project", entityId: id } });
    return tx.project.findUnique({ where: { id }, select: { id: true, name: true, description: true,
      dueDate: true, status: true } });
  });
  if (!result) return NextResponse.json({ error: "Project status changed or open tasks remain" }, { status: 409 });
  return NextResponse.json({ project: result });
}
