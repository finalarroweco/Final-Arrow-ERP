import { canAccess } from "./access";
import { db } from "./db";

export async function validateEmployeeAssignment(input: { userId: string; tenantId: string;
  companyId: string; recordBranchId: string | null; employeeId: string }) {
  const employee = await db.employee.findUnique({ where: { tenantId_companyId_id: {
    tenantId: input.tenantId, companyId: input.companyId, id: input.employeeId } },
    select: { branchId: true, status: true } });
  if (!employee) return { error: "Employee not found", status: 404 } as const;
  if (!(await canAccess({ userId: input.userId, tenantId: input.tenantId, companyId: input.companyId,
    branchId: employee.branchId ?? undefined, permission: "employee:read" })))
    return { error: "Forbidden", status: 403 } as const;
  if (employee.status !== "ACTIVE" ||
    (input.recordBranchId !== null && employee.branchId !== null &&
      input.recordBranchId !== employee.branchId))
    return { error: "Employee is inactive or belongs to another branch", status: 409 } as const;
  return null;
}
