import { Prisma } from "@prisma/client";
import { db } from "./db";
import { canAccess, readableCompanyBranches } from "./access";
import { OperationalError } from "./operational-records";
import type { TermTemplateRequest } from "./payment-term-template-input";
export const termTemplateSelect = { id: true, name: true, label: true, days: true, createdAt: true,
  archivedAt: true, archiveReason: true } as const;
export async function authorizeTermTemplates(actorId: string, tenantId: string, companyId: string, manage = false) {
  const scope = { userId: actorId, tenantId, companyId };
  if (await readableCompanyBranches({ ...scope, permission: "payment-term:read" }) === false ||
    (manage && !await canAccess({ ...scope, permission: "payment-term:manage" }))) throw new OperationalError("Forbidden", 403);
  if (!await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true } }))
    throw new OperationalError("Company not found", 404);
}
export async function saveTermTemplate(actorId: string, input: TermTemplateRequest) {
  await authorizeTermTemplates(actorId, input.tenantId, input.companyId, true);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE "tenantId"=${input.tenantId}::uuid AND id=${input.companyId}::uuid FOR UPDATE`;
    if (input.action === "create") {
      const saved = await tx.paymentTermTemplate.findUnique({ where: { id: input.requestId } });
      if (saved) {
        if (saved.tenantId !== input.tenantId || saved.companyId !== input.companyId || saved.createdBy !== actorId ||
          saved.name !== input.name || saved.label !== input.label || saved.days !== input.days) throw new OperationalError("Request ID was used for different template details");
        return { template: await tx.paymentTermTemplate.findUniqueOrThrow({ where: { id: saved.id }, select: termTemplateSelect }), replayed: true };
      }
      if (await tx.paymentTermTemplate.count({ where: { tenantId: input.tenantId, companyId: input.companyId } }) >= 1000)
        throw new OperationalError("Company template history limit reached (1000)");
      const template = await tx.paymentTermTemplate.create({ data: { id: input.requestId, tenantId: input.tenantId,
        companyId: input.companyId, name: input.name, label: input.label, days: input.days, createdBy: actorId } });
      await tx.auditLog.create({ data: { tenantId: input.tenantId, actorId, entity: "PaymentTermTemplate", entityId: template.id,
        action: "payment-term.created", metadata: { companyId: input.companyId, transaction: template.creationTransaction, name: template.name, label: template.label, days: template.days } } });
      return { template: await tx.paymentTermTemplate.findUniqueOrThrow({ where: { id: template.id }, select: termTemplateSelect }), replayed: false };
    }
    const saved = await tx.paymentTermTemplate.findFirst({ where: { id: input.templateId, tenantId: input.tenantId, companyId: input.companyId } });
    if (!saved) throw new OperationalError("Template not found", 404);
    if (saved.archivedAt) {
      if (saved.archiveRequestId !== input.requestId || saved.archivedBy !== actorId || saved.archiveReason !== input.reason)
        throw new OperationalError("Template already archived by another request");
      return { template: await tx.paymentTermTemplate.findUniqueOrThrow({ where: { id: saved.id }, select: termTemplateSelect }), replayed: true };
    }
    const archived = await tx.paymentTermTemplate.update({ where: { id: saved.id }, data: { archiveRequestId: input.requestId,
      archivedBy: actorId, archiveReason: input.reason } });
    await tx.auditLog.create({ data: { tenantId: input.tenantId, actorId, entity: "PaymentTermTemplate", entityId: saved.id,
      action: "payment-term.archived", metadata: { companyId: input.companyId, requestId: input.requestId,
        transaction: archived.archiveTransaction, reason: input.reason } } });
    return { template: await tx.paymentTermTemplate.findUniqueOrThrow({ where: { id: saved.id }, select: termTemplateSelect }), replayed: false };
  }, { timeout: 15000 });
}
export function termTemplateFailure(error: unknown) {
  if (error instanceof OperationalError) return { error: error.message, status: error.status };
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2003", "P2004"].includes(error.code))
    return { error: "Active name/request already used, source changed, or template limit reached", status: 409 };
  throw error;
}
