import { z } from "zod";
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u001f]/u.test(value));
export const termTemplateScope = z.object({ tenantId: uuid, companyId: uuid });
export const termTemplateRequest = z.discriminatedUnion("action", [
  termTemplateScope.extend({ action: z.literal("create"), requestId: uuid, name: text(3, 80), label: text(3, 120), days: z.number().int().min(0).max(3650) }).strict(),
  termTemplateScope.extend({ action: z.literal("archive"), requestId: uuid, templateId: uuid, reason: text(3, 200) }).strict(),
]);
export type TermTemplateRequest = z.infer<typeof termTemplateRequest>;
export function pendingTermTemplate(raw: unknown, actorId: string, scope: z.infer<typeof termTemplateScope>) {
  const result = z.object({ version: z.literal(1), actorId: uuid, request: termTemplateRequest }).strict().safeParse(raw);
  return result.success && result.data.actorId === actorId.toLowerCase() && result.data.request.tenantId === scope.tenantId.toLowerCase() && result.data.request.companyId === scope.companyId.toLowerCase() ? result.data.request : null;
}
