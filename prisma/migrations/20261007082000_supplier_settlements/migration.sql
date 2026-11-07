CREATE UNIQUE INDEX "GoodsReceipt_tenantId_companyId_branchId_id_key" ON "GoodsReceipt"("tenantId","companyId","branchId","id");
CREATE TABLE "SupplierSettlement" (
 "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "branchId" UUID NOT NULL, "receiptId" UUID NOT NULL, "entryId" UUID NOT NULL UNIQUE,
 "kind" VARCHAR(7) NOT NULL, "amount" DECIMAL(18,3) NOT NULL,
 "reference" VARCHAR(120) NOT NULL, "createdBy" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupplierSettlement_kind_check" CHECK ("kind" IN ('PAYMENT','REFUND')),
 CONSTRAINT "SupplierSettlement_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "SupplierSettlement_reference_check" CHECK (length(trim("reference")) BETWEEN 3 AND 120),
 CONSTRAINT "SupplierSettlement_receipt_fkey" FOREIGN KEY ("tenantId","companyId","branchId","receiptId") REFERENCES "GoodsReceipt"("tenantId","companyId","branchId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "SupplierSettlement_journal_fkey" FOREIGN KEY ("tenantId","companyId","entryId") REFERENCES "JournalEntry"("tenantId","companyId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupplierSettlement_tenantId_companyId_entryId_key" ON "SupplierSettlement"("tenantId","companyId","entryId");
CREATE INDEX "SupplierSettlement_tenantId_companyId_receiptId_createdAt_idx" ON "SupplierSettlement"("tenantId","companyId","receiptId","createdAt");
CREATE FUNCTION erp_validate_supplier_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE original_id UUID; original_total NUMERIC; original_currency TEXT; payable UUID; net NUMERIC; journal RECORD; latest DATE;
BEGIN
 PERFORM 1 FROM "GoodsReceipt" WHERE "id"=NEW."receiptId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT j.id,j.total,j.currency INTO original_id,original_total,original_currency FROM "AuditLog" a
 JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid AND j."tenantId"=NEW."tenantId" AND j."companyId"=NEW."companyId"
 WHERE a."tenantId"=NEW."tenantId" AND a.entity='GoodsReceipt' AND a."entityId"=NEW."receiptId"::text AND a.action='purchase-receipt.ledger_posted'
 AND NOT EXISTS (SELECT 1 FROM "JournalEntry" rev WHERE rev."reversalOf"=j.id);
 IF original_id IS NULL THEN RAISE EXCEPTION 'An active receipt journal is required' USING ERRCODE='23514'; END IF;
 SELECT "accountId" INTO payable FROM "JournalLine" WHERE "entryId"=original_id AND position=1;
 SELECT * INTO journal FROM "JournalEntry" WHERE id=NEW."entryId";
 IF journal."branchId" IS DISTINCT FROM NEW."branchId" OR journal.currency<>original_currency OR journal.total<>NEW.amount OR journal."reversalOf" IS NOT NULL OR
 journal.number !~ (CASE NEW.kind WHEN 'PAYMENT' THEN '^SYSD-[0-9A-Z]{25}$' ELSE '^SYSC-[0-9A-Z]{25}$' END) OR
 (SELECT count(*) FROM "JournalLine" WHERE "entryId"=NEW."entryId")<>2 OR
 NOT EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId"=NEW."entryId" AND l."accountId"=payable AND
  ((NEW.kind='PAYMENT' AND l.debit=NEW.amount AND l.credit=0) OR (NEW.kind='REFUND' AND l.credit=NEW.amount AND l.debit=0))) OR
 NOT EXISTS (SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."entryId"=NEW."entryId" AND a.type='ASSET' AND
  ((NEW.kind='PAYMENT' AND l.credit=NEW.amount AND l.debit=0) OR (NEW.kind='REFUND' AND l.debit=NEW.amount AND l.credit=0)))
 THEN RAISE EXCEPTION 'Settlement journal does not match its source and accounts' USING ERRCODE='23514'; END IF;
 SELECT original_total - COALESCE(sum(j.total) FILTER (WHERE rev.id IS NULL),0) INTO net
 FROM "GoodsReturn" r JOIN "AuditLog" a ON a."tenantId"=r."tenantId" AND a.entity='GoodsReturn' AND a."entityId"=r.id::text AND a.action='purchase-return.ledger_posted'
 JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid AND j."tenantId"=NEW."tenantId" AND j."companyId"=NEW."companyId"
 LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id WHERE r."tenantId"=NEW."tenantId" AND r."receiptId"=NEW."receiptId";
 SELECT net + COALESCE(sum(CASE s.kind WHEN 'PAYMENT' THEN -s.amount ELSE s.amount END) FILTER (WHERE rev.id IS NULL),0) INTO net
 FROM "SupplierSettlement" s LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=s."entryId" WHERE s."tenantId"=NEW."tenantId" AND s."receiptId"=NEW."receiptId";
 IF (NEW.kind='PAYMENT' AND NEW.amount>net) OR (NEW.kind='REFUND' AND NEW.amount>-net) THEN
 RAISE EXCEPTION 'Settlement exceeds the available receipt balance' USING ERRCODE='23514'; END IF;
 SELECT max(d) INTO latest FROM (
  SELECT "entryDate" d FROM "JournalEntry" WHERE id=original_id
  UNION ALL SELECT COALESCE(rev."entryDate",j."entryDate") FROM "GoodsReturn" r JOIN "AuditLog" a ON a."tenantId"=r."tenantId" AND a.entity='GoodsReturn' AND a."entityId"=r.id::text AND a.action='purchase-return.ledger_posted'
   JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id WHERE r."tenantId"=NEW."tenantId" AND r."receiptId"=NEW."receiptId"
  UNION ALL SELECT COALESCE(rev."entryDate",j."entryDate") FROM "SupplierSettlement" s JOIN "JournalEntry" j ON j.id=s."entryId" LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id WHERE s."tenantId"=NEW."tenantId" AND s."receiptId"=NEW."receiptId"
 ) dates;
 IF journal."entryDate"<latest THEN RAISE EXCEPTION 'Settlement date precedes source activity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_validate_supplier_settlement() FROM PUBLIC;
CREATE TRIGGER supplier_settlement_validate BEFORE INSERT ON "SupplierSettlement" FOR EACH ROW EXECUTE FUNCTION erp_validate_supplier_settlement();
CREATE TRIGGER supplier_settlement_immutable BEFORE UPDATE OR DELETE ON "SupplierSettlement" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
REVOKE ALL ON "SupplierSettlement" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON "SupplierSettlement" FROM anon'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON "SupplierSettlement" FROM authenticated'; END IF;
END $$;
