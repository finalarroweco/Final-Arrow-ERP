import { z } from "zod";

export const pendingCatalogImport = z.object({ version: z.literal(1), tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().nullable(), kind: z.enum(["CUSTOMER", "SUPPLIER", "ITEM"]), csv: z.string().max(350000), requestId: z.string().uuid(), previewDigest: z.string().regex(/^[a-f0-9]{64}$/), mode: z.literal("commit") }).strict();
export type PendingCatalogImport = z.infer<typeof pendingCatalogImport>;
