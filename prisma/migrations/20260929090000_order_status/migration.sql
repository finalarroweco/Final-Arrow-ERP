-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SalesOrderStatus" NOT NULL DEFAULT 'NEW';

INSERT INTO "Permission" ("key") VALUES ('order:manage')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT "tenantId", "id", 'order:manage'
FROM "Role" WHERE "name" IN ('Owner', 'Manager')
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
