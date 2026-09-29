import { db } from "./db";
import { scopeMatches } from "./scope";

export async function canAccess(input: {
  userId: string; tenantId: string; permission: string;
  companyId?: string; branchId?: string;
}): Promise<boolean> {
  if (input.branchId && !input.companyId) return false;
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    select: { id: true, status: true },
  });
  if (!membership || membership.status !== "ACTIVE") return false;

  const grants = await db.roleGrant.findMany({
    where: {
      tenantId: input.tenantId,
      membershipId: membership.id,
      role: { permissions: { some: { permissionKey: input.permission } } },
    },
    include: { scopes: true },
  });
  return grants.some((grant) => grant.scopes.some((scope) => scopeMatches(scope, input)));
}
