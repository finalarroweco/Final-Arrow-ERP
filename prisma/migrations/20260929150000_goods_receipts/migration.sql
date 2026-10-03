-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_RECEIPT';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "receiptLineId" UUID;

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_orderId_key" ON "GoodsReceipt"("orderId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_tenantId_companyId_branchId_createdAt_idx" ON "GoodsReceipt"("tenantId", "companyId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_id_key" ON "GoodsReceipt"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_companyId_orderId_key" ON "GoodsReceipt"("tenantId", "companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_companyId_orderId_id_key" ON "GoodsReceipt"("tenantId", "companyId", "orderId", "id");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_tenantId_companyId_orderId_idx" ON "GoodsReceiptLine"("tenantId", "companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_tenantId_id_key" ON "GoodsReceiptLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_receiptId_orderLineId_key" ON "GoodsReceiptLine"("receiptId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_receiptLineId_key" ON "StockMovement"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_receiptLineId_key" ON "StockMovement"("tenantId", "receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_companyId_id_key" ON "PurchaseOrder"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_tenantId_orderId_id_key" ON "PurchaseOrderLine"("tenantId", "orderId", "id");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_receiptLineId_fkey" FOREIGN KEY ("tenantId", "receiptLineId") REFERENCES "GoodsReceiptLine"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_companyId_orderId_fkey" FOREIGN KEY ("tenantId", "companyId", "orderId") REFERENCES "PurchaseOrder"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_companyId_orderId_receiptId_fkey" FOREIGN KEY ("tenantId", "companyId", "orderId", "receiptId") REFERENCES "GoodsReceipt"("tenantId", "companyId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_orderId_orderLineId_fkey" FOREIGN KEY ("tenantId", "orderId", "orderLineId") REFERENCES "PurchaseOrderLine"("tenantId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_companyId_itemId_fkey" FOREIGN KEY ("tenantId", "companyId", "itemId") REFERENCES "InventoryItem"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_delta_direction";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_direction" CHECK (
  ("type"::text IN ('ADJUSTMENT_IN', 'PURCHASE_RECEIPT') AND "delta" > 0) OR
  ("type"::text = 'ADJUSTMENT_OUT' AND "delta" < 0)
);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receipt_link" CHECK (
  ("type"::text = 'PURCHASE_RECEIPT' AND "receiptLineId" IS NOT NULL) OR
  ("type"::text <> 'PURCHASE_RECEIPT' AND "receiptLineId" IS NULL)
);
