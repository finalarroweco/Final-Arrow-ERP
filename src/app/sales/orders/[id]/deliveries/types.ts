import type { SalesStockRow } from "@/lib/sales-stock-input";
export type DeliveryOrder = { id: string; tenantId: string; companyId: string; branchId: string | null; number: string; status: string; lines: { id: string; position: number; description: string }[] };
export type DeliveryBranch = { id: string; name: string; canManage: boolean; canDeliverHold: boolean; items: { id: string; sku: string; name: string; unit: string }[] };
export type DeliveryDetail = { document: SalesStockRow; corrections: SalesStockRow[]; returns: SalesStockRow[]; returnCorrections: SalesStockRow[]; canCorrect: boolean; canReturn: boolean; returnableQuantity: string };
export type DeliveryTotal = { branchId: string; branchName: string; itemId: string; itemName: string; itemSku: string; unit: string; delivered: string; returned: string; deliveryCorrections: string; returnCorrections: string; netOut: string };
