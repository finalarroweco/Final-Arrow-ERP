import type { z } from "zod";
import type { reorderListResponse } from "@/lib/stock-reorder-input";
export const reorderCsvCell = (value: unknown) => {
  const text = String(value ?? "");
  return `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
};
/** Only call after actor, scope, page and exact output verification. No reasons or cross-item totals. */
export function reorderPageCsv(report: z.infer<typeof reorderListResponse>) {
  const fields = ["observed_at", "tenant_id", "company_id", "branch_id", "policy_id", "reference", "item_id", "item_name", "item_sku", "policy_unit", "unit_revision", "version", "minimum", "target", "physical", "reserved", "available", "informational_gap_to_target", "status"];
  const rows = report.policies.map(row => [report.observedAt, row.tenantId, row.companyId, row.branchId, row.id, row.reference, row.itemId, row.itemName, row.itemSku, row.unit, row.unitVersion, row.version, row.minimumQuantity, row.targetQuantity, row.physicalQuantity, row.reservedQuantity, row.availableQuantity, row.quantityToTarget, row.status]);
  return '\uFEFF' + [fields, ...rows].map(row => row.map(reorderCsvCell).join(",")).join("\r\n") + "\r\n";
}
