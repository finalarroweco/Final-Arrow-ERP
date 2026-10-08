-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT');

-- CreateTable
CREATE TABLE "StockBalance" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "balanceId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "delta" DECIMAL(18,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockBalance_tenantId_companyId_branchId_idx" ON "StockBalance"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_tenantId_id_key" ON "StockBalance"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockBalance_tenantId_companyId_branchId_itemId_key" ON "StockBalance"("tenantId", "companyId", "branchId", "itemId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_balanceId_createdAt_idx" ON "StockMovement"("tenantId", "balanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_tenantId_companyId_id_key" ON "InventoryItem"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_tenantId_companyId_itemId_fkey" FOREIGN KEY ("tenantId", "companyId", "itemId") REFERENCES "InventoryItem"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_balanceId_fkey" FOREIGN KEY ("tenantId", "balanceId") REFERENCES "StockBalance"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_direction" CHECK (
  ("type" = 'ADJUSTMENT_IN' AND "delta" > 0) OR
  ("type" = 'ADJUSTMENT_OUT' AND "delta" < 0)
);

INSERT INTO "Permission" ("key") VALUES
  ('inventory-stock:read'), ('inventory-stock:adjust')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES ('inventory-stock:read'), ('inventory-stock:adjust')) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'inventory-stock:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
