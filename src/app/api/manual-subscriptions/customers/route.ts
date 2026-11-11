import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { subscriptionCustomerFilters } from "@/lib/manual-subscription-input";
import { loadSubscriptionAccess } from "@/lib/manual-subscription-access";
import { SubscriptionError } from "@/lib/manual-subscriptions";
import { subscriptionFailure, subscriptionHeaders as headers, uniqueSubscriptionQuery } from "@/lib/manual-subscription-route";
export async function GET(request: Request) {
 const actor = await currentUser();
 if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401, headers });
 try {
  const parsed = subscriptionCustomerFilters.safeParse(uniqueSubscriptionQuery(request));
  if (!parsed.success) throw new SubscriptionError("Invalid customer filters", 400);
  const p = parsed.data, branchId = p.branchId === "company" ? null : p.branchId;
  if (p.expectedActorId && p.expectedActorId !== actor.id) throw new SubscriptionError("Signed-in user changed. Reload before reading.", 403);
  const result = await db.$transaction(async tx => {
   await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${p.tenantId}::uuid FOR SHARE`;
   const access = await loadSubscriptionAccess(tx, actor.id, p.tenantId);
   if (!access.canManage({ companyId: p.companyId, branchId })) throw new SubscriptionError("Forbidden", 403);
   const branches = access.customerBranches(p.companyId);
   const where: Prisma.CustomerWhereInput = { tenantId: p.tenantId, companyId: p.companyId, archivedAt: null, AND: [
    branchId === null ? { branchId: null } : { OR: [{ branchId: null }, { branchId }] },
    ...(branches === null ? [] : [{ branchId: { in: branches } }]),
    ...(p.q ? [{ OR: [{ displayName: { contains: p.q, mode: "insensitive" as const } }, { code: { contains: p.q, mode: "insensitive" as const } }] }] : []),
   ] };
   const rows = await tx.customer.findMany({ where, select: { id: true, displayName: true, code: true }, orderBy: [{ displayName: "asc" }, { id: "asc" }], skip: p.page * 50, take: 51 });
   return { customers: rows.slice(0, 50).map(row => ({ id: row.id, name: row.displayName, code: row.code })), page: p.page, nextPage: rows.length > 50 ? p.page + 1 : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  return NextResponse.json({ actorId: actor.id, ...result }, { headers });
 } catch (error) { return subscriptionFailure(error); }
}
