-- AlterTable
ALTER TABLE "ProjectTask" ADD COLUMN     "assigneeEmployeeId" UUID;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_tenantId_companyId_assigneeEmployeeId_fkey" FOREIGN KEY ("tenantId", "companyId", "assigneeEmployeeId") REFERENCES "Employee"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

