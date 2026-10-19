CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID', 'VOID');
CREATE TABLE "PayrollEntry" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "branchId" UUID,
  "employeeId" UUID NOT NULL, "employeeName" TEXT NOT NULL, "employeeCode" TEXT NOT NULL,
  "period" DATE NOT NULL, "baseSalary" DECIMAL(18,3) NOT NULL, "allowances" DECIMAL(18,3) NOT NULL,
  "deductions" DECIMAL(18,3) NOT NULL, "netPay" DECIMAL(18,3) NOT NULL, "currency" VARCHAR(3) NOT NULL,
  "note" TEXT, "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedAt" TIMESTAMP(3), "approvedBy" UUID, "paidAt" TIMESTAMP(3), "paidBy" UUID,
  "paymentReference" TEXT, "voidReason" TEXT, "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollEntry_amount_check" CHECK ("baseSalary" >= 0 AND "allowances" >= 0 AND "deductions" >= 0 AND "netPay" >= 0 AND "netPay" = "baseSalary" + "allowances" - "deductions"),
  CONSTRAINT "PayrollEntry_period_check" CHECK (EXTRACT(DAY FROM "period") = 1)
);
CREATE UNIQUE INDEX "PayrollEntry_tenantId_id_key" ON "PayrollEntry"("tenantId", "id");
CREATE UNIQUE INDEX "PayrollEntry_employee_period_active_key" ON "PayrollEntry"("tenantId", "companyId", "employeeId", "period") WHERE "status" <> 'VOID';
CREATE INDEX "PayrollEntry_tenantId_companyId_branchId_period_status_idx" ON "PayrollEntry"("tenantId", "companyId", "branchId", "period", "status");
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_company_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_branch_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollEntry" ADD CONSTRAINT "PayrollEntry_employee_fkey" FOREIGN KEY ("tenantId", "companyId", "employeeId") REFERENCES "Employee"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "Permission" ("key") VALUES ('payroll:read'), ('payroll:create'), ('payroll:approve'), ('payroll:pay'), ('payroll:void') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key FROM "Role" role
CROSS JOIN (VALUES ('payroll:read'), ('payroll:create'), ('payroll:approve'), ('payroll:pay'), ('payroll:void')) permissions(key)
WHERE role."name" = 'Owner' OR (role."name" = 'Manager' AND permissions.key IN ('payroll:read', 'payroll:create'))
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
