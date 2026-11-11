import type { z } from "zod";
import type { reorderPolicy, reorderDetailResponse } from "@/lib/stock-reorder-input";
export type ReorderScopeOption = { tenantId: string; companyId: string; branchId: string; label: string; canManage: boolean };
export type ReorderPolicy = z.infer<typeof reorderPolicy>;
export type ReorderDetail = z.infer<typeof reorderDetailResponse>;
export type ReorderReadEpoch = { current: number };
