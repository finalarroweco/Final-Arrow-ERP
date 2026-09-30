import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const amount = z.string().regex(/^(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/).refine((value) => Number(value) > 0);
const schema = z.object({ tenantId: uuid, companyId: uuid, branchId: uuid.nullish(),
  number: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  description: z.string().trim().min(2).max(300),
  category: z.string().trim().min(2).max(80),
  amount, expenseDate: dueDate }).strict();

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
    companyId: companyId.data, permission: "expense:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const expenses = await db.expense.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, number: true, description: true, category: true, amount: true,
      currency: true, expenseDate: true, status: true, branchId: true, postedAt: true,
      voidedAt: true, voidReason: true },
    orderBy: [{ expenseDate: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  return NextResponse.json({ expenses: expenses.slice(0, 50), nextPage: expenses.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid expense" }, { status: 400 });
  const { tenantId, companyId, branchId, expenseDate, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "expense:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } },
    select: { baseCurrency: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  try {
    const expense = await db.$transaction(async (tx) => {
      const expense = await tx.expense.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        ...data, expenseDate: new Date(`${expenseDate}T00:00:00.000Z`),
        currency: company.baseCurrency, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "expense.created",
        entity: "Expense", entityId: expense.id } });
      return expense;
    });
    return NextResponse.json({ expense }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Expense number already in use" }, { status: 409 });
    throw error;
  }
}
