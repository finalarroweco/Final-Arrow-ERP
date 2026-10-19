import { z } from "zod";
export const posScope = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid() });
export const posMoney = z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/);
export const posNumber = z.string().trim().regex(/^[A-Z0-9-]{2,30}$/);
