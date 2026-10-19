import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { canAccess } from "./access";
import { catalogKind, parseCatalogCsv, type CatalogRecord, type PartyRecord, type ItemRecord } from "./catalog-csv";
import { OperationalError } from "./operational-records";
export const importScope = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().nullable().default(null), kind: catalogKind }).strict();
export type ImportScope = z.infer<typeof importScope>;
const sources = { CUSTOMER: ["customer", "Customer", "customer.created"], SUPPLIER: ["supplier", "Supplier", "supplier.created"], ITEM: ["inventory-item", "InventoryItem", "inventory-item.created"] } as const;
export async function authorizeImport(scope: ImportScope, actorId: string) {
 for (const action of ["read", "create"]) if (!(await canAccess({ userId: actorId, tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId ?? undefined, permission: sources[scope.kind][0] + ":" + action }))) throw new OperationalError("Forbidden", 403);
 if (!(await db.company.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: scope.companyId } }, select: { id: true } }))) throw new OperationalError("Company not found", 404);
 if (scope.branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId: scope.tenantId, companyId: scope.companyId, id: scope.branchId } }, select: { id: true } }))) throw new OperationalError("Branch not found", 404);
}
export function prepareImport(scope: ImportScope, csv: string) {
 const preview = parseCatalogCsv(scope.kind, csv);
 const digest = createHash("sha256").update(JSON.stringify({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, kind: scope.kind, records: preview.records })).digest("hex");
 return { ...preview, digest };
}
async function collisions(tx: Prisma.TransactionClient, scope: ImportScope, records: CatalogRecord[]) {
 const codes = records.map(record => "sku" in record ? record.sku : record.code);
 const where = { tenantId: scope.tenantId, companyId: scope.companyId };
 const existing = scope.kind === "ITEM" ? (await tx.inventoryItem.findMany({ where: { ...where, sku: { in: codes } }, select: { sku: true } })).map(row => row.sku) : scope.kind === "CUSTOMER" ? (await tx.customer.findMany({ where: { ...where, code: { in: codes } }, select: { code: true } })).map(row => row.code) : (await tx.supplier.findMany({ where: { ...where, code: { in: codes } }, select: { code: true } })).map(row => row.code);
 return new Set(existing);
}
export async function previewImport(scope: ImportScope, csv: string) {
 const result = prepareImport(scope, csv);
 // Only collision flags are returned, never records from other branches.
 if (!result.errors.length) {
  const existing = await collisions(db, scope, result.records);
  result.records.forEach((record, index) => { const code = "sku" in record ? record.sku : record.code; if (existing.has(code)) result.errors.push({ row: index + 2, field: scope.kind === "ITEM" ? "sku" : "code", message: "Code already in use in this company (including archived records)" }); });
 }
 return { ...result, canCommit: result.errors.length === 0 && result.rowCount > 0 };
}
const batchSelect = { id: true, tenantId: true, companyId: true, branchId: true, kind: true, digest: true, rowCount: true, createdBy: true, createdAt: true } as const;
export async function commitImport(scope: ImportScope, actorId: string, csv: string, requestId: string, previewDigest: string) {
 const prepared = prepareImport(scope, csv);
 if (prepared.errors.length || prepared.rowCount < 1 || prepared.digest !== previewDigest) throw new OperationalError("Preview is invalid or has changed; preview the file again", 400);
 return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${scope.companyId}::uuid AND "tenantId"=${scope.tenantId}::uuid FOR UPDATE`;
  const prior = await tx.catalogImportBatch.findUnique({ where: { id: requestId }, select: batchSelect });
  if (prior) {
   if (prior.tenantId !== scope.tenantId || prior.companyId !== scope.companyId || prior.branchId !== scope.branchId || prior.kind !== scope.kind || prior.createdBy !== actorId || prior.digest !== prepared.digest || prior.rowCount !== prepared.rowCount) throw new OperationalError("Import request ID already used with different data");
   return { batch: prior, replayed: true };
  }
  if ((await collisions(tx, scope, prepared.records)).size) throw new OperationalError("A code is already in use; preview the file again");
  const batch = await tx.catalogImportBatch.create({ data: { id: requestId, ...scope, digest: prepared.digest, rowCount: prepared.rowCount, createdBy: actorId }, select: batchSelect });
  const common = { tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId, createdBy: actorId, importBatchId: requestId };
  const ids = prepared.records.map(() => randomUUID());
  if (scope.kind === "ITEM") await tx.inventoryItem.createMany({ data: (prepared.records as ItemRecord[]).map((record, i) => ({ ...common, ...record, id: ids[i] })) });
  else if (scope.kind === "CUSTOMER") await tx.customer.createMany({ data: (prepared.records as PartyRecord[]).map((record, i) => ({ ...common, ...record, id: ids[i] })) });
  else await tx.supplier.createMany({ data: (prepared.records as PartyRecord[]).map((record, i) => ({ ...common, ...record, id: ids[i] })) });
  const [clock] = await tx.$queryRaw<{ transaction: string }[]>`SELECT txid_current()::text AS transaction`;
  await tx.auditLog.createMany({ data: ids.map(id => ({ tenantId: scope.tenantId, actorId, entity: sources[scope.kind][1], entityId: id, action: sources[scope.kind][2], metadata: { importBatchId: requestId, transaction: clock.transaction } })) });
  await tx.auditLog.create({ data: { tenantId: scope.tenantId, actorId, entity: "CatalogImportBatch", entityId: requestId, action: "catalog-import.committed", metadata: { digest: prepared.digest, kind: scope.kind, rowCount: prepared.rowCount, transaction: clock.transaction } } });
  return { batch, replayed: false };
 }, { timeout: 30000, maxWait: 10000 });
}
export async function importHistory(scope: ImportScope, page: number) {
 const rows = await db.catalogImportBatch.findMany({ where: scope, select: batchSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: page * 50, take: 51 });
 return { batches: rows.slice(0, 50), nextPage: rows.length > 50 ? page + 1 : null };
}
