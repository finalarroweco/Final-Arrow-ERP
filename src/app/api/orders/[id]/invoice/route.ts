import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

import {vatChoices,calculateInvoiceVat,VatConflict} from "@/lib/invoice-vat";
const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid,
  vat:vatChoices.optional(), number: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!uuid.safeParse(id).success || !parsed.success)
    return NextResponse.json({ error: "Invalid invoice" }, { status: 400 });
  const { tenantId, number,vat } = parsed.data;
  const order = await db.salesOrder.findUnique({ where: { tenantId_id: { tenantId, id } },
    select: { companyId: true, branchId: true } });
  if (!order) return NextResponse.json({ error: "Sales order not found" }, { status: 404 });
  const scope = { userId: actor.id, tenantId, companyId: order.companyId, branchId: order.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "invoice:create" })) ||
    !(await canAccess({ ...scope, permission: "order:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const invoice = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${order.companyId}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
      const profile=await tx.companyVatProfile.findUnique({where:{companyId:order.companyId}});
      const taxable=profile?.enabled&&profile.effectiveFrom&&profile.effectiveFrom.toISOString().slice(0,10)<=new Date().toISOString().slice(0,10);
      if(taxable&&!vat)throw new VatConflict("Classify VAT for each line in this registered company");
      if(!taxable&&vat)throw new VatConflict("Company VAT is not active for this date");
      const source = await tx.salesOrder.findUnique({ where: { tenantId_id: { tenantId, id } },
        include: { lines: { orderBy: { position: "asc" } } } });
      if (!source || source.status !== "COMPLETED") return null;
      const invoice = await tx.invoice.create({ data: { tenantId, companyId: source.companyId,
        branchId: source.branchId, customerId: source.customerId, orderId: source.id,
        number, customerName: source.customerName, currency: source.currency,
        subtotal: source.subtotal, notes: source.notes, createdBy: actor.id,
        lines: { create: source.lines.map((line) => ({ position: line.position,
          description: line.description, quantity: line.quantity,
          unitPrice: line.unitPrice, amount: line.amount })) } }, include: { lines: true } });
      if(taxable&&vat&&profile){if(source.currency!=="OMR")throw new VatConflict("Oman VAT currently requires OMR");const calculated=calculateInvoiceVat(source.lines,vat);await tx.invoiceVat.create({data:{invoiceId:invoice.id,tenantId,companyId:source.companyId,...calculated,outputAccountId:profile.outputAccountId!,taxNumber:profile.taxNumber!,sellerName:profile.sellerName!,sellerAddress:profile.sellerAddress!}});}
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "invoice.created",
        entity: "Invoice", entityId: invoice.id,
        metadata: { orderId: source.id, subtotal: source.subtotal.toString(), currency: source.currency } } });
      return tx.invoice.findUniqueOrThrow({where:{id:invoice.id},include:{lines:true,vat:true}});
    });
    if (!invoice) return NextResponse.json({ error: "Sales order must be completed" }, { status: 409 });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) {
    if(error instanceof VatConflict)return NextResponse.json({error:error.message},{status:409});
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Order already invoiced or invoice number is in use" }, { status: 409 });
    throw error;
  }
}
