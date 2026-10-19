import { z } from "zod";
export const reportKind = z.enum(["CUSTOMER_BALANCES", "CUSTOMER_AGING", "SUPPLIER_BALANCES", "SUPPLIER_AGING"]);
export type ReportKind = z.infer<typeof reportKind>;
export const reportDateMode = z.enum(["FIXED", "TODAY_UTC", "PREVIOUS_MONTH_END_UTC"]);
export const reportDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value => {
 const date = new Date(value + "T00:00:00Z"); return value >= "0001-01-01" && value <= "9999-12-31" && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"));
export const reportFields = { name: text(120).pipe(z.string().min(2)), dateMode: reportDateMode, asOf: reportDate.nullable().default(null), q: text(120).default("") };
export function checkReportDate(value: { dateMode: string; asOf: string | null }, context: z.RefinementCtx) {
 if ((value.dateMode === "FIXED") !== (value.asOf !== null)) context.addIssue({ code: "custom", path: ["asOf"], message: "A fixed date is required only for FIXED mode" });
}
export const reportScope = { tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().nullable().default(null), kind: reportKind };
export const createReportInput = z.object({ ...reportScope, ...reportFields, requestId: z.string().uuid() }).strict().superRefine(checkReportDate);
export const updateReportInput = z.object({ tenantId: z.string().uuid(), ...reportFields, archived: z.boolean(), expectedVersion: z.number().int().min(1).max(999), requestId: z.string().uuid() }).strict().superRefine(checkReportDate);
export type CreateReportInput = z.infer<typeof createReportInput>;
export type UpdateReportInput = z.infer<typeof updateReportInput>;
const paths: Record<ReportKind, string> = { CUSTOMER_BALANCES: "/accounting/customer-balances", CUSTOMER_AGING: "/accounting/customer-aging", SUPPLIER_BALANCES: "/purchasing/supplier-balances", SUPPLIER_AGING: "/purchasing/supplier-aging" };
export function reportTarget(value: { kind: ReportKind; tenantId: string; companyId: string; branchId: string | null; dateMode: z.infer<typeof reportDateMode>; asOf: string | null; q: string }, now = new Date()) {
 let asOf = value.asOf;
 if (value.dateMode !== "FIXED") {
  asOf = now.toISOString().slice(0, 10);
  if (value.dateMode === "PREVIOUS_MONTH_END_UTC") { const date = new Date(asOf.slice(0, 7) + "-01T00:00:00Z"); date.setUTCDate(0); asOf = date.toISOString().slice(0, 10); }
 }
 asOf = reportDate.parse(asOf);
 const query = new URLSearchParams({ scope: value.tenantId + ":" + value.companyId, asOf, q: value.q, ...(value.branchId ? { branchId: value.branchId } : {}) });
 return paths[value.kind] + "?" + query;
}
export function reportPermissions(kind: ReportKind) { return kind.startsWith("CUSTOMER") ? ["customer:read", "order:read", "invoice:read", "ledger:read"] : ["supplier:read", "purchase-order:read", "inventory-stock:read", "ledger:read"]; }
export const pendingReportRequest = z.object({ version: z.literal(1), actorId: z.string().uuid(), scope: z.object(reportScope).strict(), request: z.discriminatedUnion("mode", [z.object({ mode: z.literal("create"), payload: z.object({ ...reportScope, ...reportFields, requestId: z.string().uuid() }).strict() }).strict(), z.object({ mode: z.literal("update"), id: z.string().uuid(), payload: z.object({ tenantId: z.string().uuid(), ...reportFields, archived: z.boolean(), expectedVersion: z.number().int().min(1).max(999), requestId: z.string().uuid() }).strict() }).strict()]) }).strict().superRefine((value, context) => {
 checkReportDate(value.request.payload, context);
 if (value.scope.tenantId !== value.request.payload.tenantId || (value.request.mode === "create" && (value.scope.companyId !== value.request.payload.companyId || value.scope.branchId !== value.request.payload.branchId || value.scope.kind !== value.request.payload.kind))) context.addIssue({ code: "custom", message: "Retry scope mismatch" });
});
export type PendingReportRequest = z.infer<typeof pendingReportRequest>;
export function decodeReportPending(raw: string | null, actorId: string) { try { if (!raw || raw.length > 8000) return null; const parsed = pendingReportRequest.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.actorId === actorId ? parsed.data : null; } catch { return null; } }
