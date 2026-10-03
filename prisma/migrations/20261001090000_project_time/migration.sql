CREATE TABLE "ProjectTimeEntry" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "workDate" DATE NOT NULL,
  "minutes" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTimeEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectTimeEntry_minutes_check" CHECK ("minutes" BETWEEN 1 AND 1440)
);
CREATE UNIQUE INDEX "ProjectTimeEntry_tenantId_id_key" ON "ProjectTimeEntry"("tenantId", "id");
CREATE INDEX "ProjectTimeEntry_tenantId_companyId_projectId_workDate_idx" ON "ProjectTimeEntry"("tenantId", "companyId", "projectId", "workDate");
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_project_fkey" FOREIGN KEY ("tenantId", "companyId", "projectId") REFERENCES "Project"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_employee_fkey" FOREIGN KEY ("tenantId", "companyId", "employeeId") REFERENCES "Employee"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "Permission" ("key") VALUES ('project-time:read'), ('project-time:manage') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key FROM "Role" AS role
CROSS JOIN (VALUES ('project-time:read'), ('project-time:manage')) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager') ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
