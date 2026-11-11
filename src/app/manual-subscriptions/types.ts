import type { SubscriptionEvent } from "@/lib/manual-subscription-input";
export type SubscriptionScopeOption = { tenantId: string; companyId: string; branchId: string | null; label: string; canManage: boolean };
export type SubscriptionDetail = { actorId: string; subscription: SubscriptionCurrent; events: SubscriptionEvent[]; page: number; nextPage: number | null; canManage: boolean };
export type SubscriptionFields = { serviceLabel: string; description: string; agreementReference: string; status: "PLANNED" | "ACTIVE" | "PAUSED" | "ENDED"; startDate: string | null; endDate: string | null; nextReviewDate: string | null };
export type SubscriptionCurrent = SubscriptionFields & { id: string; tenantId: string; companyId: string; branchId: string | null; customerId: string; customerBranchId: string | null; customerName: string; customerCode: string; reference: string; version: number; archived: boolean; createdBy: string; createdAt: string; updatedAt: string };
export type SubscriptionMetadata = Omit<SubscriptionCurrent, "description">;

// Shared only by one mounted actor/scope workspace; never a global cache.
export type SubscriptionReadEpoch = { current: number };
