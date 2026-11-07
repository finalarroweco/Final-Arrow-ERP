-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "customerId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,3) NOT NULL,
    "notes" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,3) NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orderId_key" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_companyId_branchId_createdAt_idx" ON "Invoice"("tenantId", "companyId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_companyId_number_key" ON "Invoice"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_companyId_orderId_key" ON "Invoice"("tenantId", "companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_id_key" ON "Invoice"("tenantId", "id");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_position_key" ON "InvoiceLine"("invoiceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_companyId_id_key" ON "SalesOrder"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_customerId_fkey" FOREIGN KEY ("tenantId", "companyId", "customerId") REFERENCES "Customer"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_orderId_fkey" FOREIGN KEY ("tenantId", "companyId", "orderId") REFERENCES "SalesOrder"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "Invoice"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("key") VALUES
  ('invoice:read'), ('invoice:create'), ('invoice:issue'), ('invoice:void')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('invoice:read'), ('invoice:create'), ('invoice:issue'), ('invoice:void')
) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key = 'invoice:read')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
