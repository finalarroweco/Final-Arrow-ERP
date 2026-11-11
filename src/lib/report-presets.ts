import { z } from "zod";
export const registerReportKind = z.enum(["INVOICE_REGISTER", "EXPENSE_REGISTER", "QUOTE_REGISTER", "SALES_ORDER_REGISTER", "PURCHASE_ORDER_REGISTER"]);
export type RegisterReportKind = z.infer<typeof registerReportKind>;
export const registerTypes = { INVOICE_REGISTER: "invoices", EXPENSE_REGISTER: "expenses", QUOTE_REGISTER: "quotes", SALES_ORDER_REGISTER: "orders", PURCHASE_ORDER_REGISTER: "purchase-orders" } as const;
export const registerStatuses = { INVOICE_REGISTER: ["DRAFT", "ISSUED", "VOID"], EXPENSE_REGISTER: ["DRAFT", "POSTED", "VOID"], QUOTE_REGISTER: ["DRAFT", "SENT", "ACCEPTED", "REJECTED"], SALES_ORDER_REGISTER: ["NEW", "IN_PROGRESS", "COMPLETED", "CANCELLED"], PURCHASE_ORDER_REGISTER: ["DRAFT", "ISSUED", "RECEIVED", "CANCELLED"] } as const;
export function isRegisterReport(kind: string): kind is RegisterReportKind { return registerReportKind.safeParse(kind).success; }
export const reportKind = z.enum(["CUSTOMER_BALANCES", "CUSTOMER_AGING", "SUPPLIER_BALANCES", "SUPPLIER_AGING", "CUSTOMER_OVERDUE", "SUPPLIER_OVERDUE", ...registerReportKind.options]);
export type ReportKind = z.infer<typeof reportKind>;
export const reportDateMode = z.enum(["FIXED", "TODAY_UTC", "PREVIOUS_MONTH_END_UTC", "FIXED_RANGE", "CURRENT_MONTH_UTC", "PREVIOUS_MONTH_UTC"]);
export type ReportDateMode = z.infer<typeof reportDateMode>;
export const reportDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value => {
 const date = new Date(value + "T00:00:00Z"); return value >= "0001-01-01" && value <= "9999-12-31" && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const text = (max: number) => z.string().trim().max(max).refine(value => !value.includes("\0"));
// New fields stay optional, rather than receiving defaults, to preserve legacy retry digests.
export const reportFields = { name: text(120).pipe(z.string().min(2)), dateMode: reportDateMode, asOf: reportDate.nullable().default(null), q: text(120).default(""), from: reportDate.nullable().optional(), to: reportDate.nullable().optional(), status: z.enum(["DRAFT", "POSTED", "VOID", "ISSUED", "RECEIVED", "CANCELLED", "SENT", "ACCEPTED", "REJECTED", "NEW", "IN_PROGRESS", "COMPLETED"]).nullable().optional() };
type Filters = { dateMode: string; asOf: string | null; from?: string | null; to?: string | null; status?: string | null };
export function isRangeMode(mode: string) { return ["FIXED_RANGE", "CURRENT_MONTH_UTC", "PREVIOUS_MONTH_UTC"].includes(mode); }
export function checkReportDate(value: Filters, context: z.RefinementCtx) {
 if (isRangeMode(value.dateMode)) {
  if (value.asOf !== null) context.addIssue({ code: "custom", path: ["asOf"], message: "Register reports use a date range" });
  if (value.dateMode === "FIXED_RANGE") {
   if (!value.from || !value.to || value.to < value.from || (Date.parse(value.to) - Date.parse(value.from)) / 86400000 >= 366) context.addIssue({ code: "custom", path: ["to"], message: "A valid range of at most 366 days is required" });
  } else if (value.from != null || value.to != null) context.addIssue({ code: "custom", path: ["from"], message: "Relative ranges are resolved on opening" });
 } else {
  if ((value.dateMode === "FIXED") !== (value.asOf !== null)) context.addIssue({ code: "custom", path: ["asOf"], message: "A fixed date is required only for FIXED mode" });
  if (value.from != null || value.to != null || value.status != null) context.addIssue({ code: "custom", message: "As-of reports cannot have register filters" });
 }
}
export function checkReportKind(value: Filters, kind: ReportKind, context: z.RefinementCtx) {
 if (isRegisterReport(kind) !== isRangeMode(value.dateMode)) context.addIssue({ code: "custom", path: ["dateMode"], message: "Date rule does not match report type" });
 if (isRegisterReport(kind) && value.status && !(registerStatuses[kind] as readonly string[]).includes(value.status)) context.addIssue({ code: "custom", path: ["status"], message: "Status does not match report type" });
}
export const reportScope = { tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().nullable().default(null), kind: reportKind };
const createShape = { ...reportScope, ...reportFields, requestId: z.string().uuid() };
const updateShape = { tenantId: z.string().uuid(), ...reportFields, archived: z.boolean(), expectedVersion: z.number().int().min(1).max(999), requestId: z.string().uuid() };
export const createReportInput = z.object(createShape).strict().superRefine((value, context) => { checkReportDate(value, context); checkReportKind(value, value.kind, context); });
export const updateReportInput = z.object(updateShape).strict().superRefine(checkReportDate);
export function validReportKindFilters(value: z.infer<typeof updateReportInput>, kind: ReportKind) { return z.object(updateShape).strict().superRefine((value, context) => { checkReportDate(value, context); checkReportKind(value, kind, context); }).safeParse(value).success; }
export type CreateReportInput = z.infer<typeof createReportInput>;
export type UpdateReportInput = z.infer<typeof updateReportInput>;
const paths = { CUSTOMER_OVERDUE: "/accounting/customer-overdue", SUPPLIER_OVERDUE: "/purchasing/supplier-overdue", CUSTOMER_BALANCES: "/accounting/customer-balances", CUSTOMER_AGING: "/accounting/customer-aging", SUPPLIER_BALANCES: "/purchasing/supplier-balances", SUPPLIER_AGING: "/purchasing/supplier-aging" } as const;
export function reportTarget(value: Filters & { kind: ReportKind; tenantId: string; companyId: string; branchId: string | null; q: string }, now = new Date()) {
 if (isRegisterReport(value.kind)) {
  let from = value.from, to = value.to;
  if (value.dateMode !== "FIXED_RANGE") {
   to = now.toISOString().slice(0, 10); from = to.slice(0, 7) + "-01";
   if (value.dateMode === "PREVIOUS_MONTH_UTC") { const date = new Date(from + "T00:00:00Z"); date.setUTCDate(0); to = date.toISOString().slice(0, 10); from = to.slice(0, 7) + "-01"; }
  }
  const query = new URLSearchParams({ tenantId: value.tenantId, companyId: value.companyId, kind: value.kind, from: reportDate.parse(from), to: reportDate.parse(to), q: value.q, ...(value.branchId ? { branchId: value.branchId } : {}), ...(value.status ? { status: value.status } : {}) });
  return "/reports/register?" + query;
 }
 let asOf = value.asOf;
 if (value.dateMode !== "FIXED") {
  asOf = now.toISOString().slice(0, 10);
  if (value.dateMode === "PREVIOUS_MONTH_END_UTC") { const date = new Date(asOf.slice(0, 7) + "-01T00:00:00Z"); date.setUTCDate(0); asOf = date.toISOString().slice(0, 10); }
 }
 asOf = reportDate.parse(asOf);
 const query = new URLSearchParams({ scope: value.tenantId + ":" + value.companyId, asOf, q: value.q, ...(value.branchId ? { branchId: value.branchId } : {}) });
 return paths[value.kind] + "?" + query;
}
export function reportPermissions(kind: ReportKind) {
 if (isRegisterReport(kind)) return [{ INVOICE_REGISTER: "invoice:read", EXPENSE_REGISTER: "expense:read", QUOTE_REGISTER: "quote:read", SALES_ORDER_REGISTER: "order:read", PURCHASE_ORDER_REGISTER: "purchase-order:read" }[kind]];
 return kind.startsWith("CUSTOMER") ? ["customer:read", "invoice:read", "ledger:read"] : ["supplier:read", "purchase-order:read", "inventory-stock:read", "ledger:read"];
}
/** Source kinds are alternatives, not an AND of unrelated financial permissions. */
export function reportSourcePermissions(kind:ReportKind){return kind.startsWith("CUSTOMER")?["order:read","billing-subscription:read"]:[];}
export const pendingReportRequest = z.object({ version: z.literal(1), actorId: z.string().uuid(), scope: z.object(reportScope).strict(), request: z.discriminatedUnion("mode", [z.object({ mode: z.literal("create"), payload: z.object(createShape).strict() }).strict(), z.object({ mode: z.literal("update"), id: z.string().uuid(), payload: z.object(updateShape).strict() }).strict()]) }).strict().superRefine((value, context) => {
 checkReportDate(value.request.payload, context); checkReportKind(value.request.payload, value.scope.kind, context);
 if (value.scope.tenantId !== value.request.payload.tenantId || (value.request.mode === "create" && (value.scope.companyId !== value.request.payload.companyId || value.scope.branchId !== value.request.payload.branchId || value.scope.kind !== value.request.payload.kind))) context.addIssue({ code: "custom", message: "Retry scope mismatch" });
});
export type PendingReportRequest = z.infer<typeof pendingReportRequest>;
export function decodeReportPending(raw: string | null, actorId: string) { try { if (!raw || raw.length > 8000) return null; const parsed = pendingReportRequest.safeParse(JSON.parse(raw)); return parsed.success && parsed.data.actorId === actorId ? parsed.data : null; } catch { return null; } }
