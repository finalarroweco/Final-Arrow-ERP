import { z } from "zod";
import type { TransferRow } from "./types";
const uuid = z.string().uuid();
const row = z.object({
  id: uuid, tenantId: uuid, companyId: uuid, sourceBranchId: uuid, destinationBranchId: uuid, itemId: uuid,
  quantity: z.string().regex(/^(?=.*[1-9])(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/), reference: z.string().min(3).max(120), reason: z.string().min(3).max(300),
  createdBy: uuid, createdAt: z.string().datetime(), unit: z.string().min(1).max(16), itemName: z.string(), itemSku: z.string(), companyName: z.string(),
  sourceBranchName: z.string(), destinationBranchName: z.string(), actorName: z.string(), correctsId: uuid.nullable(),
});
const detail = row.extend({ corrections: z.array(row).max(1), canCorrect: z.boolean() });
export function validatedTransferDetail(value: unknown, expected: TransferRow): TransferRow | null {
  const result = detail.safeParse(value); if (!result.success) return null;
  const data = result.data;
  const fields = ["id", "tenantId", "companyId", "sourceBranchId", "destinationBranchId", "itemId", "createdBy", "correctsId", "quantity", "unit", "reference", "reason", "createdAt"] as const;
  if (fields.some(field => data[field] !== expected[field])) return null;
  if ((data.correctsId || data.corrections.length) && data.canCorrect) return null;
  if (data.correctsId && data.corrections.length) return null;
  if (data.corrections.some(correction => correction.id === data.id || correction.quantity !== data.quantity || correction.unit !== data.unit || correction.reference !== data.reference || correction.correctsId !== data.id || correction.tenantId !== data.tenantId || correction.companyId !== data.companyId || correction.itemId !== data.itemId || correction.sourceBranchId !== data.destinationBranchId || correction.destinationBranchId !== data.sourceBranchId)) return null;
  return data;
}
