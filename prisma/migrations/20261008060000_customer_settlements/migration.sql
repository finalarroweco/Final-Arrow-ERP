CREATE UNIQUE INDEX "Invoice_tenantId_companyId_id_key" ON "Invoice"("tenantId","companyId","id");
CREATE TABLE "CustomerSettlement" (
 "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "branchId" UUID, "invoiceId" UUID NOT NULL, "entryId" UUID NOT NULL UNIQUE,
 "kind" VARCHAR(10) NOT NULL, "amount" DECIMAL(18,3) NOT NULL,
 "reference" VARCHAR(120) NOT NULL, "createdBy" UUID NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "CustomerSettlement_kind_check" CHECK ("kind" IN ('COLLECTION','REFUND')),
 CONSTRAINT "CustomerSettlement_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "CustomerSettlement_reference_check" CHECK (length(trim("reference")) BETWEEN 3 AND 120),
 CONSTRAINT "CustomerSettlement_invoice_fkey" FOREIGN KEY ("tenantId","companyId","invoiceId") REFERENCES "Invoice"("tenantId","companyId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CustomerSettlement_journal_fkey" FOREIGN KEY ("tenantId","companyId","entryId") REFERENCES "JournalEntry"("tenantId","companyId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerSettlement_tenantId_companyId_entryId_key" ON "CustomerSettlement"("tenantId","companyId","entryId");
CREATE INDEX "CustomerSettlement_tenantId_companyId_invoiceId_createdAt_idx" ON "CustomerSettlement"("tenantId","companyId","invoiceId","createdAt");
CREATE FUNCTION erp_validate_customer_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE invoice RECORD; original RECORD; receivable UUID; net NUMERIC; journal RECORD; latest DATE;
BEGIN
 SELECT * INTO invoice FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT j.* INTO original FROM "AuditLog" a JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid
 WHERE a."tenantId"=NEW."tenantId" AND a.entity='Invoice' AND a."entityId"=NEW."invoiceId"::text AND a.action='invoice.ledger_posted'
 AND j."tenantId"=NEW."tenantId" AND j."companyId"=NEW."companyId"
 AND NOT EXISTS (SELECT 1 FROM "JournalEntry" rev WHERE rev."reversalOf"=j.id);
 IF invoice.id IS NULL OR invoice.status<>'ISSUED' OR original.id IS NULL OR original.total<>invoice.subtotal OR
 original.currency<>invoice.currency OR original."branchId" IS DISTINCT FROM invoice."branchId" OR NEW."branchId" IS DISTINCT FROM invoice."branchId" THEN
 RAISE EXCEPTION 'An active issued invoice journal with matching scope is required' USING ERRCODE='23514'; END IF;
 SELECT l."accountId" INTO receivable FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId"
 WHERE l."entryId"=original.id AND l.position=0 AND l.debit=original.total AND l.credit=0 AND a.type='ASSET';
 SELECT * INTO journal FROM "JournalEntry" WHERE id=NEW."entryId";
 IF receivable IS NULL OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=original.id)<>2 OR
 journal.id IS NULL OR journal."branchId" IS DISTINCT FROM NEW."branchId" OR journal.currency<>original.currency OR journal.total<>NEW.amount OR journal."reversalOf" IS NOT NULL OR
 journal.number !~ (CASE NEW.kind WHEN 'COLLECTION' THEN '^SYSK-[0-9A-Z]{25}$' ELSE '^SYSF-[0-9A-Z]{25}$' END) OR
 (SELECT count(*) FROM "JournalLine" WHERE "entryId"=NEW."entryId")<>2 OR
 NOT EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId"=NEW."entryId" AND l."accountId"=receivable AND
  ((NEW.kind='COLLECTION' AND l.credit=NEW.amount AND l.debit=0 AND l.position=1) OR (NEW.kind='REFUND' AND l.debit=NEW.amount AND l.credit=0 AND l.position=0))) OR
 NOT EXISTS (SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."entryId"=NEW."entryId" AND a.type='ASSET' AND l."accountId"<>receivable AND
  ((NEW.kind='COLLECTION' AND l.debit=NEW.amount AND l.credit=0 AND l.position=0) OR (NEW.kind='REFUND' AND l.credit=NEW.amount AND l.debit=0 AND l.position=1)))
 THEN RAISE EXCEPTION 'Customer settlement journal does not match source accounts' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(sum(CASE s.kind WHEN 'COLLECTION' THEN s.amount ELSE -s.amount END) FILTER (WHERE rev.id IS NULL),0) INTO net
 FROM "CustomerSettlement" s LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=s."entryId" WHERE s."tenantId"=NEW."tenantId" AND s."invoiceId"=NEW."invoiceId";
 IF (NEW.kind='COLLECTION' AND NEW.amount>original.total-net) OR (NEW.kind='REFUND' AND NEW.amount>net) THEN
 RAISE EXCEPTION 'Customer settlement exceeds available invoice balance' USING ERRCODE='23514'; END IF;
 SELECT max(d) INTO latest FROM (
  SELECT original."entryDate" d UNION ALL
  SELECT COALESCE(rev."entryDate",j."entryDate") FROM "CustomerSettlement" s JOIN "JournalEntry" j ON j.id=s."entryId" LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id WHERE s."tenantId"=NEW."tenantId" AND s."invoiceId"=NEW."invoiceId"
 ) dates;
 IF journal."entryDate"<latest THEN RAISE EXCEPTION 'Customer settlement date precedes source activity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_validate_customer_settlement() FROM PUBLIC;
CREATE TRIGGER customer_settlement_validate BEFORE INSERT ON "CustomerSettlement" FOR EACH ROW EXECUTE FUNCTION erp_validate_customer_settlement();
CREATE TRIGGER customer_settlement_immutable BEFORE UPDATE OR DELETE ON "CustomerSettlement" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
-- Source-first locking applies to corrections too. Prevent corrections from
-- leaving a refunded collection or overpaid invoice, including direct DB writes.
CREATE FUNCTION erp_validate_customer_correction() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE saved RECORD; invoice_id UUID; invoice_total NUMERIC; net NUMERIC; latest DATE;
BEGIN
 IF NEW."reversalOf" IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO saved FROM "CustomerSettlement" WHERE "entryId"=NEW."reversalOf";
 IF saved.id IS NOT NULL THEN invoice_id:=saved."invoiceId";
 ELSE
 SELECT a."entityId"::uuid INTO invoice_id FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a.entity='Invoice' AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=NEW."reversalOf"::text;
 END IF;
 IF invoice_id IS NULL THEN RETURN NEW; END IF;
 SELECT subtotal INTO invoice_total FROM "Invoice" WHERE id=invoice_id AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT COALESCE(sum(CASE s.kind WHEN 'COLLECTION' THEN s.amount ELSE -s.amount END) FILTER (WHERE rev.id IS NULL),0),max(COALESCE(rev."entryDate",j."entryDate")) INTO net,latest
 FROM "CustomerSettlement" s JOIN "JournalEntry" j ON j.id=s."entryId" LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id WHERE s."invoiceId"=invoice_id AND s."tenantId"=NEW."tenantId";
 IF latest IS NOT NULL AND NEW."entryDate"<latest THEN RAISE EXCEPTION 'Invoice correction precedes settlement activity' USING ERRCODE='23514'; END IF;
 IF saved.id IS NULL THEN
  IF EXISTS (SELECT 1 FROM "CustomerSettlement" s WHERE s."invoiceId"=invoice_id AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=s."entryId")) THEN
   RAISE EXCEPTION 'Reverse active customer settlements before the invoice journal' USING ERRCODE='23514'; END IF;
 ELSE
  net:=net+(CASE saved.kind WHEN 'COLLECTION' THEN -saved.amount ELSE saved.amount END);
  IF net<0 OR net>invoice_total THEN RAISE EXCEPTION 'Customer correction would exceed the invoice balance' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_validate_customer_correction() FROM PUBLIC;
CREATE TRIGGER customer_correction_validate BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION erp_validate_customer_correction();
REVOKE ALL ON "CustomerSettlement" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON "CustomerSettlement" FROM anon'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON "CustomerSettlement" FROM authenticated'; END IF;
END $$;
