-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Supplier_tenantId_companyId_branchId_idx" ON "Supplier"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_companyId_displayName_idx" ON "Supplier"("tenantId", "companyId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_companyId_code_key" ON "Supplier"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_id_key" ON "Supplier"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("key") VALUES
  ('supplier:read'), ('supplier:create'), ('supplier:update'), ('supplier:archive')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('supplier:read'), ('supplier:create'), ('supplier:update'), ('supplier:archive')
) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'supplier:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
