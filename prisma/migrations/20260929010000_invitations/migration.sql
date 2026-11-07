-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "type" "ScopeType" NOT NULL,
    "companyId" UUID,
    "branchId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_tenantId_email_idx" ON "Invitation"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Invitation_expiresAt_idx" ON "Invitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_roleId_fkey" FOREIGN KEY ("tenantId", "roleId") REFERENCES "Role"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_scope_shape_check" CHECK (
  ("type" = 'TENANT' AND "companyId" IS NULL AND "branchId" IS NULL) OR
  ("type" = 'COMPANY' AND "companyId" IS NOT NULL AND "branchId" IS NULL) OR
  ("type" = 'BRANCH' AND "companyId" IS NOT NULL AND "branchId" IS NOT NULL)
);
