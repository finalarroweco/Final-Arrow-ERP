import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "./db";
import { readableCompanyBranches } from "./access";
import { operationalParent, operationalAudit, OperationalError } from "./operational-records";
import { deadlineChangeInput, deadlineReportInput, ticketDeadlineState, type DeadlineState } from "./ticket-deadline-input";
const changeSelect = { id: true, tenantId: true, companyId: true, ticketId: true, sequence: true, dueAt: true, reason: true, createdBy: true, createdAt: true } as const;
const ticketSelect = { id: true, tenantId: true, companyId: true, branchId: true, number: true, subject: true, status: true, priority: true, resolutionDueAt: true, deadlineSequence: true } as const;
export async function ticketDeadlineDetails(actorId: string, tenantId: string, id: string, page: number) {
 await operationalParent("ticket", id, tenantId, actorId);
 return db.$transaction(async tx => {
  const ticket = await tx.ticket.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id } }, select: ticketSelect });
  const records = await tx.ticketDeadlineChange.findMany({ where: { tenantId, ticketId: id }, select: changeSelect, orderBy: { sequence: "desc" }, skip: page * 50, take: 51 });
  const users = await tx.user.findMany({ where: { id: { in: [...new Set(records.slice(0, 50).map(row => row.createdBy))] } }, select: { id: true, name: true } }), names = new Map(users.map(user => [user.id, user.name])), evaluatedAt = new Date().toISOString();
  return { ticket: { ...ticket, deadlineState: ticketDeadlineState(ticket.status, ticket.resolutionDueAt?.toISOString() ?? null, evaluatedAt) }, evaluatedAt, changes: records.slice(0, 50).map(row => ({ ...row, authorName: names.get(row.createdBy) ?? null })), nextPage: records.length > 50 ? page + 1 : null };
 }, { isolationLevel: "RepeatableRead", timeout: 15000 });
}
export async function changeTicketDeadline(actorId: string, id: string, input: z.infer<typeof deadlineChangeInput>) {
 const parent = await operationalParent("ticket", id, input.tenantId, actorId, true);
 return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${id}::uuid AND "tenantId"=${input.tenantId}::uuid FOR UPDATE`;
  const prior = await tx.ticketDeadlineChange.findUnique({ where: { id: input.requestId }, select: changeSelect });
  if (prior) { if (prior.tenantId !== input.tenantId || prior.ticketId !== id || prior.createdBy !== actorId || prior.sequence !== input.expectedSequence + 1 || (prior.dueAt?.toISOString() ?? null) !== input.dueAt || prior.reason !== input.reason) throw new OperationalError("Request ID already used with different deadline data"); return { change: prior, replayed: true }; }
  const change = await tx.ticketDeadlineChange.create({ data: { id: input.requestId, tenantId: input.tenantId, companyId: parent.companyId, ticketId: id, sequence: input.expectedSequence + 1, dueAt: input.dueAt ? new Date(input.dueAt) : null, reason: input.reason, createdBy: actorId }, select: changeSelect });
  await operationalAudit(tx, input.tenantId, actorId, "TicketDeadlineChange", change.id, "ticket-deadline.changed", id, change.sequence);
  return { change, replayed: false };
 }, { timeout: 15000, maxWait: 10000 });
}
export async function ticketDeadlineReport(actorId: string, raw: unknown) {
 const parsed = deadlineReportInput.safeParse(raw); if (!parsed.success) throw new OperationalError("Invalid deadline report filters", 400);
 const input = parsed.data, branches = await readableCompanyBranches({ userId: actorId, tenantId: input.tenantId, companyId: input.companyId, permission: "ticket:read" });
 if (branches === false || (input.branchId && branches !== null && !branches.includes(input.branchId))) throw new OperationalError("Forbidden", 403);
 if (input.branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId: input.tenantId, companyId: input.companyId, id: input.branchId } }, select: { id: true } }))) throw new OperationalError("Branch not found", 404);
 const now = new Date(), active: Prisma.TicketWhereInput = { status: { in: ["OPEN", "IN_PROGRESS"] } };
 const stateWhere: Record<DeadlineState, Prisma.TicketWhereInput> = { OVERDUE: { ...active, resolutionDueAt: { lt: now } }, UPCOMING: { ...active, resolutionDueAt: { gte: now } }, NO_DEADLINE: { ...active, resolutionDueAt: null }, INACTIVE: { status: { in: ["RESOLVED", "CLOSED"] } } };
 const rows = await db.ticket.findMany({ where: { tenantId: input.tenantId, companyId: input.companyId, ...(input.branchId ? { branchId: input.branchId } : branches === null ? {} : { branchId: { in: branches } }), AND: [...(input.state === "ALL" ? [] : [stateWhere[input.state]]), ...(input.status ? [{ status: input.status }] : []), ...(input.priority ? [{ priority: input.priority }] : []), ...(input.q ? [{ OR: [{ number: { contains: input.q, mode: "insensitive" as const } }, { subject: { contains: input.q, mode: "insensitive" as const } }] }] : [])] }, select: ticketSelect, orderBy: [{ resolutionDueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }], take: 5001 });
 if (rows.length > 5000) throw new OperationalError("More than 5000 tickets match. Narrow the branch, state, priority or search.", 413);
 const evaluatedAt = now.toISOString(), summary: Record<DeadlineState, number> = { OVERDUE: 0, UPCOMING: 0, NO_DEADLINE: 0, INACTIVE: 0 };
 const result = rows.map(row => { const resolutionDueAt = row.resolutionDueAt?.toISOString() ?? null, state = ticketDeadlineState(row.status, resolutionDueAt, evaluatedAt); summary[state]++; return { ...row, resolutionDueAt, deadlineState: state }; });
 return { tenantId: input.tenantId, companyId: input.companyId, branchId: input.branchId ?? null, state: input.state, status: input.status ?? null, priority: input.priority ?? null, q: input.q, format: input.format, basis: "CURRENT_MANUAL_RESOLUTION_DEADLINE", evaluatedAt, summary, count: result.length, rows: result };
}
