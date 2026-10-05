import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { documentJournal, lockDocument } from "@/lib/document-journal";
const uuid = z.string().uuid();
const schema = z.union([
  z.object({ tenantId: uuid, action: z.literal("approve") }).strict(),
  z.object({ tenantId: uuid, action: z.literal("pay"), reference: z.string().trim().min(3).max(200) }).strict(),
  z.object({ tenantId: uuid, action: z.literal("void"), reason: z.string().trim().min(3).max(500) }).strict(),
]);
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params; const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid payroll action" }, { status: 400 });
  const { tenantId, action } = parsed.data;
  const entry = await db.payrollEntry.findUnique({ where: { tenantId_id: { tenantId, id } }, select: { companyId: true, branchId: true } });
  if (!entry) return NextResponse.json({ error: "Payroll not found" }, { status: 404 });
  if (!(await canAccess({ userId: actor.id, tenantId, companyId: entry.companyId, branchId: entry.branchId ?? undefined, permission: `payroll:${action}` })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const data = parsed.data;
  const result = await db.$transaction(async (tx) => {
    await lockDocument(tx,"payroll",tenantId,id);
    if (action === "void") {
      const journal=await documentJournal(tx,"payroll",tenantId,entry.companyId,id);
      if (journal && !journal.reversal) return {ledgerBlocked:true as const};
    }
    const changed = await tx.payrollEntry.updateMany({ where: { tenantId, id,
      status: action === "approve" ? "DRAFT" : action === "pay" ? "APPROVED" : { in: ["DRAFT", "APPROVED"] } },
      data: data.action === "approve" ? { status: "APPROVED", approvedAt: new Date(), approvedBy: actor.id }
        : data.action === "pay" ? { status: "PAID", paidAt: new Date(), paidBy: actor.id, paymentReference: data.reference }
        : { status: "VOID", voidReason: data.reason } });
    if (changed.count !== 1) return null;
    await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: `payroll.${action === "approve" ? "approved" : action === "pay" ? "paid" : "voided"}`,
      entity: "PayrollEntry", entityId: id } });
    return tx.payrollEntry.findUnique({ where: { id } });
  });
  if (result && "ledgerBlocked" in result) return NextResponse.json({error:"Reverse the linked payroll accrual journal before voiding"},{status:409});
  if (!result) return NextResponse.json({ error: "Payroll status changed or action unavailable" }, { status: 409 });
  return NextResponse.json({ entry: result });
}
