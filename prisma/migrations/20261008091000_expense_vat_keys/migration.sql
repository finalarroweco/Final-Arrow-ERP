CREATE UNIQUE INDEX "ExpenseVat_tenantId_companyId_entryId_key" ON "ExpenseVat"("tenantId","companyId","entryId");
CREATE UNIQUE INDEX "ExpenseVat_tenantId_companyId_expenseId_key" ON "ExpenseVat"("tenantId","companyId","expenseId");
