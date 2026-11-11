import { z } from "zod";
import { salesStockRow, type SalesStockRow } from "@/lib/sales-stock-input";
import type { DeliveryDetail } from "./types";
const detail = z.object({ document: salesStockRow, corrections: z.array(salesStockRow).max(1), returns: z.array(salesStockRow).max(5000), returnCorrections: z.array(salesStockRow).max(5000), canCorrect: z.boolean(), canReturn: z.boolean(), returnableQuantity: z.string().regex(/^\d+(?:\.\d{1,3})?$/) });
export function validatedDeliveryDetail(value: unknown, expected: SalesStockRow): DeliveryDetail | null {
  const checked = detail.safeParse(value); if (!checked.success) return null;
  const data = checked.data, row = data.document;
  // Every original field is immutable, including the snapshot labels shown on print.
  if (Object.keys(salesStockRow.shape).some(field => row[field as keyof SalesStockRow] !== expected[field as keyof SalesStockRow])) return null;
  const sameSource = (other: SalesStockRow) => other.tenantId === row.tenantId && other.companyId === row.companyId && other.orderId === row.orderId && other.branchId === row.branchId && other.itemId === row.itemId && other.lineId === row.lineId && other.unit === row.unit;
  if (data.corrections.some(correction => correction.id === row.id || correction.kind !== "CORRECTION" || correction.correctsId !== row.id || correction.quantity !== row.quantity || !sameSource(correction))) return null;
  if (data.returns.some(returned => returned.id === row.id || returned.kind !== "RETURN" || returned.deliveryId !== row.id || !sameSource(returned))) return null;
  if ((row.kind === "CORRECTION" || data.corrections.length > 0) && (data.canCorrect || data.canReturn)) return null;
  if (data.returnCorrections.some(correction => correction.kind !== "CORRECTION" || !sameSource(correction) || !data.returns.some(returned => returned.id === correction.correctsId && returned.quantity === correction.quantity))) return null;
  if (row.kind !== "DELIVERY" && (data.canReturn || data.returns.length > 0)) return null;
  return data;
}
