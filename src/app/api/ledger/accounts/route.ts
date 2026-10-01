import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { ledgerScope, queryInput } from "@/lib/ledger";
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = ledgerScope.extend({ page: z.coerce.number().int().min(0).max(100000).default(0) }).safeParse(queryInput(new URL(request.url).searchParams, ["tenantId", "companyId", "page"]));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const { tenantId, companyId, page } = parsed.data;
  if (await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "ledger:read" }) === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const accounts = await db.ledgerAccount.findMany({ where: { tenantId, companyId }, select: { id: true, code: true, name: true, type: true }, orderBy: [{ code: "asc" }, { id: "asc" }], skip: page * 100, take: 101 });
  return NextResponse.json({ accounts: accounts.slice(0,100), nextPage: accounts.length > 100 ? page+1 : null });
}
export async function POST(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = ledgerScope.extend({ code: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/), name: z.string().trim().min(2).max(200), type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  if (!(await canAccess({ userId: actor.id, tenantId: parsed.data.tenantId, companyId: parsed.data.companyId, permission: "ledger-account:manage" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await db.company.findUnique({ where: { tenantId_id: { tenantId: parsed.data.tenantId, id: parsed.data.companyId } }, select: { id: true } }))) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  try {
    const account = await db.$transaction(async (tx) => {
      const account = await tx.ledgerAccount.create({ data: { ...parsed.data, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId: account.tenantId, actorId: actor.id, action: "ledger-account.created", entity: "LedgerAccount", entityId: account.id } });
      return account;
    }); return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Account code already in use" }, { status: 409 });
    throw error;
  }
}
