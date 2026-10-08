-- CreateEnum
CREATE TYPE "PosOrderStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PosOrderType" AS ENUM ('DINE_IN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD');

-- CreateTable
CREATE TABLE "PosItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" DECIMAL(18,3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "PosOrderType" NOT NULL,
    "tableLabel" TEXT,
    "note" TEXT,
    "status" "PosOrderStatus" NOT NULL DEFAULT 'OPEN',
    "total" DECIMAL(18,3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentMethod" "PosPaymentMethod",
    "paymentReference" TEXT,
    "tendered" DECIMAL(18,3),
    "change" DECIMAL(18,3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PosOrderLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,3) NOT NULL,
    "amount" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "PosOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosItem_tenantId_companyId_branchId_active_idx" ON "PosItem"("tenantId", "companyId", "branchId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PosItem_companyId_code_key" ON "PosItem"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PosItem_tenantId_companyId_id_key" ON "PosItem"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "PosOrder_tenantId_companyId_branchId_status_createdAt_idx" ON "PosOrder"("tenantId", "companyId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_companyId_number_key" ON "PosOrder"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrder_tenantId_companyId_id_key" ON "PosOrder"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PosOrderLine_orderId_position_key" ON "PosOrderLine"("orderId", "position");

-- AddForeignKey
ALTER TABLE "PosItem" ADD CONSTRAINT "PosItem_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosItem" ADD CONSTRAINT "PosItem_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_tenantId_companyId_orderId_fkey" FOREIGN KEY ("tenantId", "companyId", "orderId") REFERENCES "PosOrder"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_tenantId_companyId_itemId_fkey" FOREIGN KEY ("tenantId", "companyId", "itemId") REFERENCES "PosItem"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PosItem" ADD CONSTRAINT "PosItem_price_check" CHECK ("price" > 0);
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_total_check" CHECK ("total" > 0);
ALTER TABLE "PosOrderLine" ADD CONSTRAINT "PosOrderLine_amount_check" CHECK ("quantity" BETWEEN 1 AND 999 AND "unitPrice" > 0 AND "amount" = "quantity" * "unitPrice");
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_payment_check" CHECK (
  ("status" = 'OPEN' AND "paidAt" IS NULL AND "paymentMethod" IS NULL AND "tendered" IS NULL AND "change" IS NULL AND "cancelledAt" IS NULL AND "cancelReason" IS NULL) OR
  ("status" = 'PAID' AND "paidAt" IS NOT NULL AND "paymentMethod" IS NOT NULL AND "cancelledAt" IS NULL AND "cancelReason" IS NULL AND
    (("paymentMethod" = 'CASH' AND "tendered" IS NOT NULL AND "change" IS NOT NULL AND "tendered" >= "total" AND "change" = "tendered" - "total") OR
     ("paymentMethod" = 'CARD' AND "paymentReference" IS NOT NULL AND "tendered" IS NULL AND "change" IS NULL))) OR
  ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND "paidAt" IS NULL AND "paymentMethod" IS NULL AND "tendered" IS NULL AND "change" IS NULL)
);
INSERT INTO "Permission" ("key") VALUES ('pos:read'),('pos:manage') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId","roleId","permissionKey") SELECT role."tenantId", role."id", permissions.key FROM "Role" role
CROSS JOIN (VALUES ('pos:read'),('pos:manage')) permissions(key)
WHERE role."name" IN ('Owner','Manager') OR (role."name" = 'Viewer' AND permissions.key = 'pos:read')
ON CONFLICT ("tenantId","roleId","permissionKey") DO NOTHING;
CREATE FUNCTION verify_pos_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; expected NUMERIC; actual NUMERIC; line_count BIGINT;
BEGIN
 IF TG_TABLE_NAME = 'PosOrder' THEN target := NEW."id"; ELSE target := NEW."orderId"; END IF;
 SELECT "total" INTO expected FROM "PosOrder" WHERE "id" = target;
 SELECT COALESCE(SUM("amount"),0), COUNT(*) INTO actual,line_count FROM "PosOrderLine" WHERE "orderId" = target;
 IF line_count < 1 OR actual <> expected THEN RAISE EXCEPTION 'POS order total must match its lines' USING ERRCODE = '23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_header_total AFTER INSERT ON "PosOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_pos_total();
CREATE CONSTRAINT TRIGGER pos_line_total AFTER INSERT ON "PosOrderLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_pos_total();
CREATE TRIGGER immutable_pos_line BEFORE UPDATE OR DELETE ON "PosOrderLine" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION protect_pos_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'POS orders cannot be deleted' USING ERRCODE = '23514'; END IF;
 IF OLD."status" <> 'OPEN' OR NEW."status" = 'OPEN' OR (to_jsonb(NEW) - ARRAY['status','paymentMethod','paymentReference','tendered','change','paidAt','cancelledAt','cancelReason']) <> (to_jsonb(OLD) - ARRAY['status','paymentMethod','paymentReference','tendered','change','paidAt','cancelledAt','cancelReason']) THEN
 RAISE EXCEPTION 'Only payment or cancellation of an open POS order is allowed' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_pos_header BEFORE UPDATE OR DELETE ON "PosOrder" FOR EACH ROW EXECUTE FUNCTION protect_pos_order();
