ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_RETURN';
ALTER TABLE "GoodsReceiptLine" ADD COLUMN "returnedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_returned_bounds" CHECK ("returnedQuantity" >= 0 AND "returnedQuantity" <= "quantity");
CREATE UNIQUE INDEX "GoodsReceiptLine_tenantId_receiptId_id_key" ON "GoodsReceiptLine"("tenantId", "receiptId", "id");
CREATE TABLE "GoodsReturn" (
 "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "receiptId" UUID NOT NULL,
 "reason" TEXT NOT NULL, "createdBy" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "GoodsReturn_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "GoodsReturn_reason_length" CHECK (length(trim("reason")) BETWEEN 3 AND 150)
);
CREATE UNIQUE INDEX "GoodsReturn_tenantId_receiptId_id_key" ON "GoodsReturn"("tenantId", "receiptId", "id");
CREATE INDEX "GoodsReturn_tenantId_receiptId_createdAt_idx" ON "GoodsReturn"("tenantId", "receiptId", "createdAt");
ALTER TABLE "GoodsReturn" ADD CONSTRAINT "GoodsReturn_receipt_fkey" FOREIGN KEY ("tenantId", "receiptId") REFERENCES "GoodsReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "GoodsReturnLine" (
 "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "receiptId" UUID NOT NULL,
 "returnId" UUID NOT NULL, "receiptLineId" UUID NOT NULL, "quantity" INTEGER NOT NULL,
 CONSTRAINT "GoodsReturnLine_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "GoodsReturnLine_quantity_bounds" CHECK ("quantity" BETWEEN 1 AND 100000)
);
CREATE UNIQUE INDEX "GoodsReturnLine_tenantId_id_key" ON "GoodsReturnLine"("tenantId", "id");
CREATE UNIQUE INDEX "GoodsReturnLine_returnId_receiptLineId_key" ON "GoodsReturnLine"("returnId", "receiptLineId");
CREATE INDEX "GoodsReturnLine_tenantId_receiptId_receiptLineId_idx" ON "GoodsReturnLine"("tenantId", "receiptId", "receiptLineId");
ALTER TABLE "GoodsReturnLine" ADD CONSTRAINT "GoodsReturnLine_return_fkey" FOREIGN KEY ("tenantId", "receiptId", "returnId") REFERENCES "GoodsReturn"("tenantId", "receiptId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReturnLine" ADD CONSTRAINT "GoodsReturnLine_source_fkey" FOREIGN KEY ("tenantId", "receiptId", "receiptLineId") REFERENCES "GoodsReceiptLine"("tenantId", "receiptId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD COLUMN "returnLineId" UUID;
CREATE UNIQUE INDEX "StockMovement_returnLineId_key" ON "StockMovement"("returnLineId");
CREATE UNIQUE INDEX "StockMovement_tenantId_returnLineId_key" ON "StockMovement"("tenantId", "returnLineId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_returnLine_fkey" FOREIGN KEY ("tenantId", "returnLineId") REFERENCES "GoodsReturnLine"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_delta_direction";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_direction" CHECK (
 ("type"::text IN ('ADJUSTMENT_IN', 'PURCHASE_RECEIPT') AND "delta" > 0) OR
 ("type"::text IN ('ADJUSTMENT_OUT', 'PURCHASE_RETURN') AND "delta" < 0)
);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_return_link" CHECK (
 ("type"::text = 'PURCHASE_RETURN' AND "returnLineId" IS NOT NULL) OR
 ("type"::text <> 'PURCHASE_RETURN' AND "returnLineId" IS NULL)
);

CREATE OR REPLACE FUNCTION erp_record_receipt_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  -- Only the nested return-line guard may advance the return counter.
  IF TG_OP = 'UPDATE' AND pg_trigger_depth() > 1 AND
    (to_jsonb(NEW) - 'returnedQuantity') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'returnedQuantity') AND
    NEW."returnedQuantity" > OLD."returnedQuantity" THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Saved receipt lines are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."quantity" <> trunc(NEW."quantity") OR NEW."quantity" <= 0 OR NEW."quantity" > 100000 THEN
    RAISE EXCEPTION 'Receipt quantity must be a positive whole unit' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM "PurchaseOrder" WHERE "id" = NEW."orderId" AND "tenantId" = NEW."tenantId"
    AND "companyId" = NEW."companyId" AND "status" IN ('ISSUED','RECEIVED') FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order cannot be received' USING ERRCODE = '23514';
  END IF;
  UPDATE "PurchaseOrderLine" SET "receivedQuantity" = "receivedQuantity" + NEW."quantity"::integer
    WHERE "id" = NEW."orderLineId" AND "tenantId" = NEW."tenantId" AND "orderId" = NEW."orderId"
      AND "receivedQuantity" + NEW."quantity" <= "quantity";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt exceeds remaining order quantity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION erp_record_return_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE source_movement UUID;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  RAISE EXCEPTION 'Saved returns are immutable' USING ERRCODE = '23514';
 END IF;
 SELECT "id" INTO source_movement FROM "StockMovement"
 WHERE "tenantId" = NEW."tenantId" AND "receiptLineId" = NEW."receiptLineId" AND "type"::text = 'PURCHASE_RECEIPT' FOR UPDATE;
 IF source_movement IS NULL OR EXISTS (SELECT 1 FROM "AuditLog" WHERE "tenantId" = NEW."tenantId" AND "entity" = 'StockMovement' AND "entityId" = source_movement::text AND "action" = 'inventory-stock.reversed') THEN
  RAISE EXCEPTION 'Receipt stock movement is missing or reversed' USING ERRCODE = '23514';
 END IF;
 UPDATE "GoodsReceiptLine" SET "returnedQuantity" = "returnedQuantity" + NEW."quantity"
 WHERE "id" = NEW."receiptLineId" AND "tenantId" = NEW."tenantId" AND "receiptId" = NEW."receiptId"
 AND "returnedQuantity" + NEW."quantity" <= "quantity";
 IF NOT FOUND THEN RAISE EXCEPTION 'Return exceeds remaining receipt quantity' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION erp_immutable_goods_return() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Saved return documents are immutable' USING ERRCODE = '23514';
END;
$$;
REVOKE EXECUTE ON FUNCTION erp_record_return_quantity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erp_immutable_goods_return() FROM PUBLIC;
CREATE TRIGGER erp_return_quantity_guard BEFORE INSERT OR UPDATE OR DELETE ON "GoodsReturnLine" FOR EACH ROW EXECUTE FUNCTION erp_record_return_quantity();
CREATE TRIGGER erp_return_header_immutable BEFORE UPDATE OR DELETE ON "GoodsReturn" FOR EACH ROW EXECUTE FUNCTION erp_immutable_goods_return();
-- The ERP connects through its own server-side authorisation; these are not public API tables.
REVOKE ALL ON "GoodsReturn", "GoodsReturnLine" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON "GoodsReturn", "GoodsReturnLine" FROM anon'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON "GoodsReturn", "GoodsReturnLine" FROM authenticated'; END IF;
END $$;
