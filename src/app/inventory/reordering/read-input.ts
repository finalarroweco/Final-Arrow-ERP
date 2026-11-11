import { z } from "zod";
import { reorderDetailResponse, reorderListResponse } from "@/lib/stock-reorder-input";
import type { ReorderScopeOption } from "./types";
const actorReceipt = z.object({ actorId: z.string().uuid() });
export function reorderActorMatches(raw: unknown, actorId: string) {
  const result = actorReceipt.safeParse(raw);
  return result.success && result.data.actorId === actorId;
}
export function belongsToScope(value: { tenantId: string; companyId: string; branchId: string }, scope: Pick<ReorderScopeOption, "tenantId" | "companyId" | "branchId">) {
  return value.tenantId === scope.tenantId && value.companyId === scope.companyId && value.branchId === scope.branchId;
}
export function verifiedReorderList(raw: unknown, scope: ReorderScopeOption, page: number, actorId: string, state: string) {
  if (!reorderActorMatches(raw, actorId)) return null;
  const result = reorderListResponse.safeParse(raw);
  if (!result.success) return null;
  const value = result.data;
  if (new Set(value.policies.map(row => row.id)).size !== value.policies.length) return null;
  if (value.page !== page || (value.nextPage !== null && value.nextPage !== page + 1) || value.policies.some(row => !belongsToScope(row, scope) || (state === "ACTIVE" && row.archived) || (state === "ARCHIVED" && !row.archived))) return null;
  return value;
}
export function verifiedReorderDetail(raw: unknown, scope: ReorderScopeOption, id: string, page: number, actorId: string) {
  if (!reorderActorMatches(raw, actorId)) return null;
  const result = reorderDetailResponse.safeParse(raw);
  if (!result.success) return null;
  const value = result.data, current = value.policy;
  if (current.id !== id || !belongsToScope(current, scope) || value.page !== page || (value.nextPage !== null && value.nextPage !== page + 1)) return null;
  const identity = ["itemId", "unit", "unitVersion", "itemName", "itemSku", "itemBranchId", "reference"] as const;
  if (value.events.some((event, index) => event.policyId !== id || !belongsToScope(event, scope) || identity.some(key => event[key] !== current[key]) || event.version > current.version || (index > 0 && event.version !== value.events[index - 1].version - 1))) return null;
  if (new Set(value.events.map(event => event.id)).size !== value.events.length) return null;
  const latest = value.events[0], fields = ["version", "minimumQuantity", "targetQuantity", "archived"] as const;
  if (page === 0 && (!latest || fields.some(key => latest[key] !== current[key]))) return null;
  return value;
}
