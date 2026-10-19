import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid,
  companyId: uuid,
  branchId: uuid.nullish(),
  code: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).nullish(),
  email: z.string().trim().email().max(255).nullish(),
  phone: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(2000).nullish(),
}).strict();

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const branches = await readableCompanyBranches({
    userId: actor.id, tenantId: tenantId.data, companyId: companyId.data, permission: "customer:read",
  });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const customers = await db.customer.findMany({
    where: {
      tenantId: tenantId.data, companyId: companyId.data,
      archivedAt: params.get("archived") === "true" ? { not: null } : null,
      ...(branches === null ? {} : { branchId: { in: branches } }),
    },
    select: { id: true, code: true, displayName: true, legalName: true,
      email: true, phone: true, notes: true, branchId: true, archivedAt: true },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    skip: page.data * 50,
    take: 51,
  });
  return NextResponse.json({ customers: customers.slice(0, 50),
    nextPage: customers.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });
  const { tenantId, companyId, branchId, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "customer:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({
    where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId) {
    const branch = await db.branch.findUnique({
      where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true },
    });
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }
  try {
    const customer = await db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { tenantId, companyId, branchId: branchId ?? null, ...data, createdBy: actor.id },
      });
      await tx.auditLog.create({
        data: { tenantId, actorId: actor.id, action: "customer.created",
          entity: "Customer", entityId: customer.id },
      });
      return customer;
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Customer code already in use" }, { status: 409 });
    throw error;
  }
}
