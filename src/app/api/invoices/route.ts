import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId: tenantId.data,
    companyId: companyId.data, permission: "invoice:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const invoices = await db.invoice.findMany({ where: { tenantId: tenantId.data,
    companyId: companyId.data, ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, number: true, orderId: true, customerName: true, branchId: true,
      status: true, issuedAt: true, voidedAt: true, voidReason: true,
      currency: true, subtotal: true, createdAt: true,
      lines: { select: { position: true, description: true, quantity: true, unitPrice: true, amount: true },
        orderBy: { position: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ invoices: invoices.slice(0, 50), nextPage: invoices.length > 50 ? page.data + 1 : null });
}
