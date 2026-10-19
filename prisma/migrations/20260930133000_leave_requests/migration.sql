-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "employeeId" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_companyId_branchId_status_startDate_idx" ON "LeaveRequest"("tenantId", "companyId", "branchId", "status", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_companyId_employeeId_startDate_idx" ON "LeaveRequest"("tenantId", "companyId", "employeeId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveRequest_tenantId_id_key" ON "LeaveRequest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_tenantId_companyId_id_key" ON "Employee"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_tenantId_companyId_employeeId_fkey" FOREIGN KEY ("tenantId", "companyId", "employeeId") REFERENCES "Employee"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_date_range_check" CHECK ("startDate" <= "endDate");

ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decision_check" CHECK (
  ("status" = 'PENDING' AND "decidedAt" IS NULL AND "decidedBy" IS NULL)
  OR ("status" <> 'PENDING' AND "decidedAt" IS NOT NULL AND "decidedBy" IS NOT NULL)
);

INSERT INTO "Permission" ("key") VALUES ('leave:read'), ('leave:create'), ('leave:decide')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES ('leave:read'), ('leave:create'), ('leave:decide')) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
