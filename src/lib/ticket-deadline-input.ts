import { z } from "zod";
export const deadlineInstant = z.string().datetime({ precision: 3, offset: false }).refine(value => value >= "2000-01-01T00:00:00.000Z" && value < "2100-01-01T00:00:00.000Z" && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value);
export const deadlineChangeInput = z.object({ tenantId: z.string().uuid(), requestId: z.string().uuid(), expectedSequence: z.number().int().min(0).max(999), dueAt: deadlineInstant.nullable(), reason: z.string().trim().min(3).max(1000).refine(value => !value.includes("\0")) }).strict();
export const deadlineState = z.enum(["OVERDUE", "UPCOMING", "NO_DEADLINE", "INACTIVE"]);
export type DeadlineState = z.infer<typeof deadlineState>;
export function ticketDeadlineState(status: string, dueAt: string | null, evaluatedAt: string): DeadlineState {
 if (status === "RESOLVED" || status === "CLOSED") return "INACTIVE";
 if (!dueAt) return "NO_DEADLINE";
 return Date.parse(dueAt) < Date.parse(evaluatedAt) ? "OVERDUE" : "UPCOMING";
}
// Treat the editor's wall-clock components explicitly as UTC, not the browser timezone.
export function deadlineFromEditor(value: string): string | null {
 if (!value) return null;
 const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
 if (!match) throw new Error("Invalid UTC deadline");
 return deadlineInstant.parse(match[1] + ":" + (match[2] ?? "00") + "." + (match[3] ?? "").padEnd(3, "0") + "Z");
}
export const deadlineReportInput = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().optional(), state: z.enum(["ALL", ...deadlineState.options]).default("OVERDUE"), status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), q: z.string().trim().max(120).refine(value => !value.includes("\0")).default(""), format: z.enum(["json", "csv"]).default("json") }).strict();
export const pendingDeadline = z.object({ version: z.literal(1), actorId: z.string().uuid(), ticketId: z.string().uuid(), payload: deadlineChangeInput }).strict();
export type PendingDeadline = z.infer<typeof pendingDeadline>;
export function decodeDeadlineRetry(raw: string | null, actorId: string, tenantId: string, ticketId: string) { try { if (!raw || raw.length > 10000) return null; const parsed = pendingDeadline.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.actorId === actorId && parsed.data.ticketId === ticketId && parsed.data.payload.tenantId === tenantId ? parsed.data : null; } catch { return null; } }
const csvCell = (value: string) => '"' + (/^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
export type DeadlineReportRow = { id: string; number: string; subject: string; branchId: string | null; priority: string; status: string; resolutionDueAt: string | null; deadlineSequence: number; deadlineState: DeadlineState };
export function deadlineReportCsv(report: { evaluatedAt: string; tenantId: string; companyId: string; branchId: string | null; state: string; q: string; status: string | null; priority: string | null; rows: DeadlineReportRow[] }) {
 return [["Evaluated UTC", "Tenant ID", "Company ID", "Branch filter", "State filter", "Status filter", "Priority filter", "Search", "Ticket ID", "Number", "Subject", "Branch ID", "Priority", "Status", "Resolution deadline UTC", "Deadline state", "Deadline version"], ...report.rows.map(row => [report.evaluatedAt, report.tenantId, report.companyId, report.branchId ?? "", report.state, report.status ?? "", report.priority ?? "", report.q, row.id, row.number, row.subject, row.branchId ?? "", row.priority, row.status, row.resolutionDueAt ?? "", row.deadlineState, String(row.deadlineSequence)])].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
