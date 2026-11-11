import { z } from "zod";
import { subscriptionEvent } from "@/lib/manual-subscription-input";
import type { SubscriptionScopeOption } from "./types";
const uuid = z.string().uuid();
const actorReceipt = z.object({ actorId: uuid });
export function subscriptionActorMatches(raw: unknown, expectedActorId: string) { const result = actorReceipt.safeParse(raw); return result.success && result.data.actorId === expectedActorId; }
const metadata = z.object({ id: uuid, tenantId: uuid, companyId: uuid, branchId: uuid.nullable(), customerId: uuid, customerBranchId: uuid.nullable(), customerName: z.string(), customerCode: z.string(), reference: z.string(), serviceLabel: subscriptionEvent.shape.serviceLabel, agreementReference: subscriptionEvent.shape.agreementReference, status: subscriptionEvent.shape.status, startDate: subscriptionEvent.shape.startDate, endDate: subscriptionEvent.shape.endDate, nextReviewDate: subscriptionEvent.shape.nextReviewDate, version: z.number().int().positive(), archived: z.boolean(), createdBy: uuid, createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
const sourceMatches = (row: {id:string;reference:string;branchId:string|null;customerBranchId:string|null}) => row.reference === `SUB-${row.id}` && (row.customerBranchId === null || row.customerBranchId === row.branchId);
export const subscriptionMetadata = metadata.refine(sourceMatches);
export const currentSubscription = metadata.extend({ description: subscriptionEvent.shape.description }).strict().refine(sourceMatches);
export const subscriptionList = z.object({ actorId: uuid, subscriptions: subscriptionMetadata.array().max(50), page: z.number().int().nonnegative(), nextPage: z.number().int().nonnegative().nullable() }).strict();
const detailSchema = z.object({ actorId: uuid, subscription: currentSubscription, events: subscriptionEvent.array().max(50), page: z.number().int().nonnegative(), nextPage: z.number().int().nonnegative().nullable(), canManage: z.boolean() }).strict();
export function belongsToScope(value: { tenantId: string; companyId: string; branchId: string | null }, scope: Pick<SubscriptionScopeOption, "tenantId" | "companyId" | "branchId">) { return value.tenantId === scope.tenantId && value.companyId === scope.companyId && value.branchId === scope.branchId; }
export function verifiedSubscriptionDetail(raw: unknown, scope: SubscriptionScopeOption, id: string, page: number, expectedActorId: string) {
  if (!subscriptionActorMatches(raw, expectedActorId)) return null;
  const result = detailSchema.safeParse(raw);
  if (!result.success) return null;
  const value = result.data, current = value.subscription;
  if (current.id !== id || !belongsToScope(current, scope) || value.page !== page || (value.nextPage !== null && value.nextPage !== page + 1)) return null;
  const identity = ["customerId", "customerBranchId", "customerName", "customerCode", "reference"] as const;
  if (value.events.some((event, index) => event.subscriptionId !== id || !belongsToScope(event, scope) || identity.some(key => event[key] !== current[key]) || event.version > current.version || (index > 0 && event.version >= value.events[index - 1].version))) return null;
  const latest = value.events[0], fields = ["version", "serviceLabel", "description", "agreementReference", "status", "startDate", "endDate", "nextReviewDate", "archived"] as const;
  if (page === 0 && (!latest || fields.some(key => latest[key] !== current[key]))) return null;
  return value;
}
