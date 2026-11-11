import { z } from "zod";
import { documentEvent } from "@/lib/internal-text-document-input";
import type { DocumentScopeOption } from "./types";
const uuid = z.string().uuid();
export const documentMetadata = z.object({ id: uuid, tenantId: uuid, companyId: uuid, branchId: uuid.nullable(), title: documentEvent.shape.title, version: z.number().int().positive(), archived: z.boolean(), createdBy: uuid, createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export const currentDocument = documentMetadata.extend({ body: documentEvent.shape.body });
const detailSchema = z.object({ actorId: uuid, document: currentDocument, events: documentEvent.array().max(50), page: z.number().int().nonnegative(), nextPage: z.number().int().nonnegative().nullable(), canManage: z.boolean() });
export function belongsToScope(value: { tenantId: string; companyId: string; branchId: string | null }, scope: Pick<DocumentScopeOption, "tenantId" | "companyId" | "branchId">) { return value.tenantId === scope.tenantId && value.companyId === scope.companyId && value.branchId === scope.branchId; }
export function verifiedDocumentDetail(raw: unknown, scope: DocumentScopeOption, id: string, page: number, actorId: string) {
  const result = detailSchema.safeParse(raw);
  if (!result.success) return null;
  const value = result.data;
  if (value.actorId !== actorId || value.document.id !== id || !belongsToScope(value.document, scope) || value.page !== page || (value.nextPage !== null && value.nextPage !== page + 1)) return null;
  if (value.events.some((event, index) => event.documentId !== id || !belongsToScope(event, scope) || event.version > value.document.version || (index > 0 && event.version >= value.events[index - 1].version))) return null;
  const latest = value.events[0];
  if (page === 0 && (!latest || latest.version !== value.document.version || latest.title !== value.document.title || latest.body !== value.document.body || latest.archived !== value.document.archived)) return null;
  return value;
}
