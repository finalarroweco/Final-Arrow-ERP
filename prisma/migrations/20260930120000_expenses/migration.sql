-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "expenseDate" DATE NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_tenantId_companyId_branchId_status_expenseDate_idx" ON "Expense"("tenantId", "companyId", "branchId", "status", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_companyId_number_key" ON "Expense"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_id_key" ON "Expense"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);

INSERT INTO "Permission" ("key") VALUES
  ('expense:read'), ('expense:create'), ('expense:post'), ('expense:void')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('expense:read'), ('expense:create'), ('expense:post'), ('expense:void')
) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'expense:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
