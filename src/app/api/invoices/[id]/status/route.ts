import { documentJournal, lockDocument } from "@/lib/document-journal";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ tenantId: uuid, action: z.literal("issue") }).strict(),
  z.object({ tenantId: uuid, action: z.literal("void"), reason: z.string().trim().min(3).max(300) }).strict(),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid invoice action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const invoice = await db.invoice.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: invoice.companyId,
    branchId: invoice.branchId ?? undefined, permission: action === "issue" ? "invoice:issue" : "invoice:void" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await db.$transaction(async (tx) => {
    await lockDocument(tx, "invoice", tenantId, id);
    if (action === "void") {
      const journal = await documentJournal(tx, "invoice", tenantId, invoice.companyId, id);
      if (journal && !journal.reversal) return { ledgerBlocked: true as const };
    }
    const changed = await tx.invoice.updateMany({ where: { id, tenantId,
      status: action === "issue" ? "DRAFT" : { in: ["DRAFT", "ISSUED"] } },
      data: action === "issue" ? { status: "ISSUED", issuedAt: new Date() }
        : { status: "VOID", voidedAt: new Date(), voidReason: parsed.data.reason } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id,
      action: action === "issue" ? "invoice.issued" : "invoice.voided",
      entity: "Invoice", entityId: id,
      metadata: action === "void" ? { reason: parsed.data.reason } : undefined } });
    return tx.invoice.findUnique({ where: { id }, select: { id: true, status: true,
      issuedAt: true, voidedAt: true, voidReason: true } });
  });
  if (result && "ledgerBlocked" in result) return NextResponse.json({ error: "Reverse the linked ledger journal before voiding this document" }, { status: 409 });
  if (!result) return NextResponse.json({ error: "Invoice status has changed or transition is invalid" }, { status: 409 });
  return NextResponse.json({ invoice: result });
}
