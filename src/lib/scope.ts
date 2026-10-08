export type GrantScope = {
  type: "TENANT" | "COMPANY" | "BRANCH";
  companyId: string | null;
  branchId: string | null;
};

export function scopeMatches(scope: GrantScope, target: { companyId?: string; branchId?: string }): boolean {
  if (target.branchId && !target.companyId) return false;
  if (scope.type === "TENANT") return true;
  if (!target.companyId || scope.companyId !== target.companyId) return false;
  if (scope.type === "COMPANY") return true;
  return !!target.branchId && scope.branchId === target.branchId;
}
