import { configuredApprovalRequired } from "@/lib/approval-workflows";
import { documentJournal, lockDocument } from "@/lib/document-journal";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.union([
  z.object({ tenantId: uuid, action: z.literal("post") }).strict(),
  z.object({ tenantId: uuid, action: z.literal("void"),
    reason: z.string().trim().min(3).max(300) }).strict(),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid expense action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const expense = await db.expense.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: expense.companyId,
    branchId: expense.branchId ?? undefined, permission: action === "post" ? "expense:post" : "expense:void" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Expense" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
    await lockDocument(tx, "expense", tenantId, id);
    const lockedSource = await tx.expense.findUnique({ where: { id }, select: { companyId: true, branchId: true } });
    if (!lockedSource || !(await canAccess({ userId: actor.id, tenantId, companyId: lockedSource.companyId, branchId: lockedSource.branchId ?? undefined, permission: action === "post" ? "expense:post" : "expense:void" }, tx))) return { forbidden: true as const };
    const pending = await tx.$queryRaw<{ pending: boolean }[]>`SELECT EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=${tenantId}::uuid AND resource='EXPENSE' AND "sourceId"=${id}::uuid AND status='PENDING') AS pending`;
    if (pending[0].pending || (action === "post") && await configuredApprovalRequired(tx, tenantId, "EXPENSE", id)) return { workflowRequired: true as const };
    if (action === "void") {
      const journal = await documentJournal(tx, "expense", tenantId, expense.companyId, id);
      if (journal && !journal.reversal) return { ledgerBlocked: true as const };
    }
    const changed = await tx.expense.updateMany({ where: { id, tenantId, status: action === "post" ? "DRAFT" : { in: ["DRAFT", "POSTED"] } },
      data: action === "post" ? { status: "POSTED", postedAt: new Date() }
        : { status: "VOID", voidedAt: new Date(), voidReason: parsed.data.action === "void" ? parsed.data.reason : undefined } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: action === "post" ? "expense.posted" : "expense.voided",
      entity: "Expense", entityId: id, ...(action === "void" ? { metadata: { reason: parsed.data.reason } } : {}) } });
    return tx.expense.findUnique({ where: { id }, select: { id: true, status: true, postedAt: true, voidedAt: true, voidReason: true } });
  });
  if (result && "ledgerBlocked" in result) return NextResponse.json({ error: "Reverse the linked ledger journal before voiding this document" }, { status: 409 });
  if (result && "forbidden" in result) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (result && "workflowRequired" in result) return NextResponse.json({ error: "Use the configured approval workflow, or cancel its pending request first", workflowRequired: true, sourceId: id, resource: "EXPENSE" }, { status: 409 });
  if (!result) return NextResponse.json({ error: "Expense status changed" }, { status: 409 });
  return NextResponse.json({ expense: result });
}
