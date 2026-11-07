import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { readableCompanyPermissions } from "./access";
import { reportKind, reportPermissions, type ReportKind, type CreateReportInput, type UpdateReportInput } from "./report-presets";
import { OperationalError } from "./operational-records";
export type ReportScope = { tenantId: string; companyId: string; branchId: string | null; kind: ReportKind };
export async function reportVisibility(actorId: string, tenantId: string, companyId: string, kind: ReportKind) {
 const permissions = reportPermissions(kind), rights = await readableCompanyPermissions({ userId: actorId, tenantId, companyId, permissions });
 if (Object.values(rights).some(right => right === false)) return false;
 const a = rights[permissions[2]], b = rights["ledger:read"];
 return a === null ? b : b === null ? a : (a as string[]).filter(id => (b as string[]).includes(id));
}
export async function authorizeSavedReport(actorId: string, scope: ReportScope) {
 const visible = await reportVisibility(actorId, scope.tenantId, scope.companyId, scope.kind);
 if (visible === false || (scope.branchId && visible !== null && !visible.includes(scope.branchId))) throw new OperationalError("Forbidden", 403);
 if (!(await db.company.findUnique({ where: { tenantId_id: { tenantId: scope.tenantId, id: scope.companyId } }, select: { id: true } }))) throw new OperationalError("Company not found", 404);
 if (scope.branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId: scope.tenantId, companyId: scope.companyId, id: scope.branchId } }, select: { id: true } }))) throw new OperationalError("Branch not found", 404);
}
const select = { id: true, tenantId: true, companyId: true, branchId: true, kind: true, name: true, dateMode: true, asOf: true, q: true, version: true, archivedAt: true, createdAt: true, updatedAt: true } as const;
export function publicReport<T extends { asOf: Date | null }>(value: T) { return { ...value, asOf: value.asOf?.toISOString().slice(0, 10) ?? null }; }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, version: number, requestId: string, action: string) {
 const [clock] = await tx.$queryRaw<{ transaction: string }[]>`SELECT txid_current()::text AS transaction`;
 await tx.auditLog.create({ data: { tenantId, actorId, entity: "SavedReport", entityId: id, action, metadata: { version, requestId, transaction: clock.transaction } } });
}
export async function createSavedReport(actorId: string, input: CreateReportInput) {
 await authorizeSavedReport(actorId, input);
 const digest = hash(input), { requestId, asOf, ...fields } = input;
 return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "tenantId"=${input.tenantId}::uuid AND "userId"=${actorId}::uuid FOR UPDATE`;
  const prior = await tx.savedReport.findUnique({ where: { id: requestId } });
  if (prior) { if (prior.ownerId !== actorId || prior.tenantId !== input.tenantId || prior.creationDigest !== digest) throw new OperationalError("Request ID already used for different report data"); const value = await tx.savedReport.findUniqueOrThrow({ where: { id: requestId }, select }); return { preset: publicReport(value), replayed: true }; }
  const preset = await tx.savedReport.create({ data: { ...fields, id: requestId, ownerId: actorId, asOf: asOf ? new Date(asOf + "T00:00:00Z") : null, creationDigest: digest, lastRequestId: requestId, lastRequestDigest: digest }, select });
  await audit(tx, input.tenantId, actorId, preset.id, 1, requestId, "saved-report.created"); return { preset: publicReport(preset), replayed: false };
 }, { timeout: 15000 });
}
export async function ownedSavedReport(actorId: string, tenantId: string, id: string) {
 const row = await db.savedReport.findFirst({ where: { id, tenantId, ownerId: actorId }, select });
 if (!row) throw new OperationalError("Saved report not found", 404);
 await authorizeSavedReport(actorId, { ...row, kind: reportKind.parse(row.kind) }); return row;
}
export async function updateSavedReport(actorId: string, id: string, input: UpdateReportInput) {
 await ownedSavedReport(actorId, input.tenantId, id);
 const digest = hash({ id, ...input });
 return db.$transaction(async tx => {
  await tx.$queryRaw`SELECT id FROM "SavedReport" WHERE id=${id}::uuid AND "tenantId"=${input.tenantId}::uuid AND "ownerId"=${actorId}::uuid FOR UPDATE`;
  const row = await tx.savedReport.findFirst({ where: { id, tenantId: input.tenantId, ownerId: actorId } });
  if (!row) throw new OperationalError("Saved report not found", 404);
  if (row.lastRequestId === input.requestId) { if (row.lastRequestDigest !== digest) throw new OperationalError("Request ID already used for different report data"); const value = await tx.savedReport.findUniqueOrThrow({ where: { id }, select }); return { preset: publicReport(value), replayed: true }; }
  if (row.version !== input.expectedVersion) throw new OperationalError("Saved report changed; reload before editing");
  const preset = await tx.savedReport.update({ where: { id }, data: { name: input.name, dateMode: input.dateMode, asOf: input.asOf ? new Date(input.asOf + "T00:00:00Z") : null, q: input.q, version: row.version + 1, archivedAt: input.archived ? row.archivedAt ?? new Date() : null, lastRequestId: input.requestId, lastRequestDigest: digest }, select });
  await audit(tx, input.tenantId, actorId, id, preset.version, input.requestId, "saved-report.updated"); return { preset: publicReport(preset), replayed: false };
 }, { timeout: 15000 });
}
export async function listSavedReports(actorId: string, tenantId: string, companyId: string, archived: boolean, page: number) {
 const alternatives: Prisma.SavedReportWhereInput[] = [];
 const visibility = await Promise.all(reportKind.options.map(async kind => ({ kind, branches: await reportVisibility(actorId, tenantId, companyId, kind) })));
 for (const { kind, branches } of visibility) if (branches !== false) alternatives.push({ kind, ...(branches === null ? {} : { OR: [{ branchId: null }, { branchId: { in: branches } }] }) });
 if (!alternatives.length) throw new OperationalError("Forbidden", 403);
 const rows = await db.savedReport.findMany({ where: { tenantId, companyId, ownerId: actorId, archivedAt: archived ? { not: null } : null, OR: alternatives }, select, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: page * 25, take: 26 });
 return { presets: rows.slice(0, 25).map(publicReport), nextPage: rows.length > 25 ? page + 1 : null };
}
