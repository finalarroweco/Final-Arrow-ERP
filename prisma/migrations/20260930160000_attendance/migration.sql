CREATE TABLE "AttendanceRecord" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID,
  "employeeId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER,
  "note" TEXT,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceRecord_time_check" CHECK ("startMinute" BETWEEN 0 AND 1439 AND ("endMinute" IS NULL OR ("endMinute" BETWEEN 1 AND 1440 AND "endMinute" > "startMinute")))
);
CREATE UNIQUE INDEX "AttendanceRecord_tenantId_id_key" ON "AttendanceRecord"("tenantId", "id");
CREATE UNIQUE INDEX "AttendanceRecord_tenantId_companyId_employeeId_workDate_key" ON "AttendanceRecord"("tenantId", "companyId", "employeeId", "workDate");
CREATE INDEX "AttendanceRecord_tenantId_companyId_branchId_workDate_idx" ON "AttendanceRecord"("tenantId", "companyId", "branchId", "workDate");
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_tenantId_companyId_employeeId_fkey" FOREIGN KEY ("tenantId", "companyId", "employeeId") REFERENCES "Employee"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "Permission" ("key") VALUES ('attendance:read'), ('attendance:manage') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key FROM "Role" AS role
CROSS JOIN (VALUES ('attendance:read'), ('attendance:manage')) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
