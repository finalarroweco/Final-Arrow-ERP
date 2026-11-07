-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ISSUED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "supplierId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,3) NOT NULL,
    "notes" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,3) NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_companyId_branchId_createdAt_idx" ON "PurchaseOrder"("tenantId", "companyId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_id_key" ON "PurchaseOrder"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_tenantId_orderId_idx" ON "PurchaseOrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_orderId_position_key" ON "PurchaseOrderLine"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_companyId_id_key" ON "Supplier"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_companyId_supplierId_fkey" FOREIGN KEY ("tenantId", "companyId", "supplierId") REFERENCES "Supplier"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "PurchaseOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("key") VALUES
  ('purchase-order:read'), ('purchase-order:create'), ('purchase-order:manage')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('purchase-order:read'), ('purchase-order:create'), ('purchase-order:manage')
) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'purchase-order:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
