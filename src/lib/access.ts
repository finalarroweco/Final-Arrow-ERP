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

// null means the full company is visible; an array limits reads to those branches.
export async function readableCompanyBranches(input: {
  userId: string; tenantId: string; companyId: string; permission: string;
}): Promise<string[] | null | false> {
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    select: { id: true, status: true },
  });
  if (membership?.status !== "ACTIVE") return false;
  const grants = await db.roleGrant.findMany({
    where: { tenantId: input.tenantId, membershipId: membership.id,
      role: { permissions: { some: { permissionKey: input.permission } } } },
    include: { scopes: true },
  });
  const scopes = grants.flatMap((grant) => grant.scopes);
  if (scopes.some((scope) => scope.type === "TENANT" ||
    (scope.type === "COMPANY" && scope.companyId === input.companyId))) return null;
  const ids = scopes.filter((scope) => scope.type === "BRANCH" && scope.companyId === input.companyId)
    .map((scope) => scope.branchId).filter((id): id is string => !!id);
  return ids.length ? [...new Set(ids)] : false;
}
