import { z } from "zod";
import { dueDate } from "./date";
export const ledgerScope = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid() });
export const journalFilters = ledgerScope.extend({ branchId: z.string().uuid().optional(), from: dueDate.optional(), to: dueDate.optional() })
  .refine(({ from, to }) => !from || !to || from <= to);
export const journalNumber = z.string().trim().regex(/^[A-Z0-9-]{2,30}$/).refine(value => !/^SYS[IEPRWGTDC]-/.test(value), "System document journal numbers are reserved");
export const journalAmount = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/);
export function queryInput(params: URLSearchParams, keys: string[]) {
  if (keys.some((key) => params.getAll(key).length > 1)) return null;
  return Object.fromEntries(keys.filter((key) => params.has(key)).map((key) => [key, params.get(key)]));
}
export function journalWhere(data: { tenantId: string; companyId: string; branchId?: string; from?: string; to?: string }, branches: string[] | null) {
  return { tenantId: data.tenantId, companyId: data.companyId,
    ...(data.branchId ? { branchId: data.branchId } : branches === null ? {} : { branchId: { in: branches } }),
    ...(data.from || data.to ? { entryDate: { ...(data.from ? { gte: new Date(`${data.from}T00:00:00Z`) } : {}), ...(data.to ? { lte: new Date(`${data.to}T00:00:00Z`) } : {}) } } : {}) };
}

