import type { DocumentEvent } from "@/lib/internal-text-document-input";
export type DocumentScopeOption = { tenantId: string; companyId: string; branchId: string | null; label: string; canManage: boolean };
export type DocumentDetail = { document: DocumentCurrent; events: DocumentEvent[]; page: number; nextPage: number | null; canManage: boolean };
export type DocumentCurrent = { id: string; tenantId: string; companyId: string; branchId: string | null; title: string; body: string; version: number; archived: boolean; createdBy: string; createdAt: string; updatedAt: string };
export type DocumentMetadata = Omit<DocumentCurrent, "body">;
