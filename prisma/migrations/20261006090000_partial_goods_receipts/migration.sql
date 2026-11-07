-- DropIndex
DROP INDEX "GoodsReceipt_orderId_key";

-- DropIndex
DROP INDEX "GoodsReceipt_tenantId_companyId_orderId_key";

CREATE INDEX "GoodsReceipt_orderId_createdAt_idx" ON "GoodsReceipt"("orderId", "createdAt");

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "receivedQuantity" INTEGER NOT NULL DEFAULT 0;


-- Preserve fulfilment from every existing receipt; stock corrections do not reopen orders.
UPDATE "PurchaseOrderLine" line
SET "receivedQuantity" = COALESCE((SELECT SUM(receipt."quantity")::integer FROM "GoodsReceiptLine" receipt
  WHERE receipt."tenantId" = line."tenantId" AND receipt."orderId" = line."orderId"
    AND receipt."orderLineId" = line."id"), 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_received_quantity_bounds"
  CHECK ("receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity");

-- Serialize fulfilment and reject excess quantities even for writes outside the HTTP handler.
CREATE FUNCTION erp_record_receipt_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
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
REVOKE EXECUTE ON FUNCTION erp_record_receipt_quantity() FROM PUBLIC;
CREATE TRIGGER erp_receipt_quantity_guard BEFORE INSERT OR UPDATE OR DELETE ON "GoodsReceiptLine"
FOR EACH ROW EXECUTE FUNCTION erp_record_receipt_quantity();
