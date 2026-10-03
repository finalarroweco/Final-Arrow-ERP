-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "customerId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,3) NOT NULL,
    "notes" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,3) NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_companyId_branchId_createdAt_idx" ON "SalesOrder"("tenantId", "companyId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_companyId_number_key" ON "SalesOrder"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_companyId_quoteId_key" ON "SalesOrder"("tenantId", "companyId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_id_key" ON "SalesOrder"("tenantId", "id");

-- CreateIndex
CREATE INDEX "SalesOrderLine_tenantId_orderId_idx" ON "SalesOrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_orderId_position_key" ON "SalesOrderLine"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_tenantId_companyId_id_key" ON "Quote"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_companyId_customerId_fkey" FOREIGN KEY ("tenantId", "companyId", "customerId") REFERENCES "Customer"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_companyId_quoteId_fkey" FOREIGN KEY ("tenantId", "companyId", "quoteId") REFERENCES "Quote"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_tenantId_orderId_fkey" FOREIGN KEY ("tenantId", "orderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Make the new module available to existing Owner, Manager and Viewer roles.
INSERT INTO "Permission" ("key") VALUES ('order:read'), ('order:create')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES ('order:read'), ('order:create')) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'order:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
