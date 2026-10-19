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

// Fetch each role's scopes and permissions together so rights from different roles
// cannot be combined accidentally. No authorization result survives this request.
export async function readableCompanyPermissions(input: {
  userId: string; tenantId: string; companyId: string; permissions: string[];
}): Promise<Record<string, string[] | null | false>> {
  const result: Record<string, string[] | null | false> = Object.fromEntries(
    input.permissions.map(permission => [permission, false]),
  );
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
    select: { id: true, status: true },
  });
  if (membership?.status !== "ACTIVE") return result;
  const grants = await db.roleGrant.findMany({
    where: { tenantId: input.tenantId, membershipId: membership.id,
      role: { permissions: { some: { permissionKey: { in: input.permissions } } } } },
    select: { scopes: true, role: { select: { permissions: {
      where: { permissionKey: { in: input.permissions } }, select: { permissionKey: true },
    } } } },
  });
  for (const permission of input.permissions) {
    const scopes = grants.filter(grant => grant.role.permissions.some(p => p.permissionKey === permission))
      .flatMap(grant => grant.scopes);
    if (scopes.some(scope => scope.type === "TENANT" ||
      (scope.type === "COMPANY" && scope.companyId === input.companyId))) {
      result[permission] = null;
      continue;
    }
    const ids = scopes.filter(scope => scope.type === "BRANCH" && scope.companyId === input.companyId)
      .map(scope => scope.branchId).filter((id): id is string => !!id);
    result[permission] = ids.length ? [...new Set(ids)] : false;
  }
  return result;
}
