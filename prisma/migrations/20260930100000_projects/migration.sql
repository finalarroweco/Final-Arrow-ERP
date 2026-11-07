-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "dueDate" DATE,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTask" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" DATE,
    "completedAt" TIMESTAMP(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_tenantId_companyId_branchId_status_idx" ON "Project"("tenantId", "companyId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_companyId_code_key" ON "Project"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_id_key" ON "Project"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Project_tenantId_companyId_id_key" ON "Project"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "ProjectTask_tenantId_companyId_projectId_status_idx" ON "ProjectTask"("tenantId", "companyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTask_tenantId_id_key" ON "ProjectTask"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_tenantId_companyId_projectId_fkey" FOREIGN KEY ("tenantId", "companyId", "projectId") REFERENCES "Project"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Permission" ("key") VALUES
  ('project:read'), ('project:create'), ('project:manage'),
  ('project-task:read'), ('project-task:create'), ('project-task:manage')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
SELECT role."tenantId", role."id", permissions.key
FROM "Role" AS role
CROSS JOIN (VALUES
  ('project:read'), ('project:create'), ('project:manage'),
  ('project-task:read'), ('project-task:create'), ('project-task:manage')
) AS permissions(key)
WHERE role."name" IN ('Owner', 'Manager')
  OR (role."name" = 'Viewer' AND permissions.key IN ('project:read', 'project-task:read'))
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
