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
    await lockDocument(tx, "expense", tenantId, id);
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
  if (!result) return NextResponse.json({ error: "Expense status changed" }, { status: 409 });
  return NextResponse.json({ expense: result });
}
