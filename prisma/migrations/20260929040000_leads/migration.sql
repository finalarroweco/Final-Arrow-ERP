-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "convertedCustomerId" UUID,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_tenantId_companyId_branchId_stage_idx" ON "Lead"("tenantId", "companyId", "branchId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_companyId_code_key" ON "Lead"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_id_key" ON "Lead"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_companyId_id_key" ON "Customer"("tenantId", "companyId", "id");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_companyId_convertedCustomerId_fkey" FOREIGN KEY ("tenantId", "companyId", "convertedCustomerId") REFERENCES "Customer"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

