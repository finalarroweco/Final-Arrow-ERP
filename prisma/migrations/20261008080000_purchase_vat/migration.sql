CREATE UNIQUE INDEX "GoodsReceipt_tenantId_companyId_id_key" ON "GoodsReceipt"("tenantId","companyId",id);
ALTER TABLE "CompanyVatProfile" ADD COLUMN "inputAccountId" UUID;
ALTER TABLE "CompanyVatProfile" ADD CONSTRAINT "CompanyVatProfile_input_fkey" FOREIGN KEY ("tenantId","companyId","inputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "JournalEntry" ADD COLUMN "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text;
CREATE TABLE "PurchaseVat" (
 "entryId" UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"receiptId" UUID NOT NULL,"returnId" UUID UNIQUE,
 "netAmount" NUMERIC(18,3) NOT NULL CHECK ("netAmount">=0),"taxAmount" NUMERIC(18,3) NOT NULL CHECK ("taxAmount">=0),"recoverableTax" NUMERIC(18,3) NOT NULL CHECK ("recoverableTax">=0 AND "recoverableTax"<="taxAmount"),
 "inputAccountId" UUID,"supplierName" VARCHAR(200) NOT NULL,"supplierTaxNumber" VARCHAR(40) NOT NULL CHECK(length(trim("supplierTaxNumber")) BETWEEN 3 AND 40),"reference" VARCHAR(120) NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 120),"details" JSONB NOT NULL CHECK(jsonb_typeof(details)='array'),
 FOREIGN KEY("tenantId","companyId","entryId") REFERENCES "JournalEntry"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","receiptId") REFERENCES "GoodsReceipt"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","receiptId","returnId") REFERENCES "GoodsReturn"("tenantId","receiptId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","inputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "PurchaseVat_receipt_original_key" ON "PurchaseVat"("receiptId") WHERE "returnId" IS NULL;
CREATE UNIQUE INDEX "PurchaseVat_tenantId_companyId_entryId_key" ON "PurchaseVat"("tenantId","companyId","entryId");
CREATE UNIQUE INDEX "PurchaseVat_tenantId_receiptId_returnId_key" ON "PurchaseVat"("tenantId","receiptId","returnId");
CREATE INDEX "PurchaseVat_tenantId_receiptId_idx" ON "PurchaseVat"("tenantId","receiptId");
CREATE FUNCTION erp_validate_purchase_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD; j RECORD; p RECORD; original RECORD; d JSONB; original_d JSONB; line_id UUID; qty NUMERIC; n NUMERIC; t NUMERIC; prior_qty NUMERIC; deductible BOOLEAN; sum_net NUMERIC:=0; sum_tax NUMERIC:=0; sum_input NUMERIC:=0; seen UUID[]:=ARRAY[]::UUID[]; purchase_account UUID; payable_account UUID;
BEGIN
 SELECT g.*,o.currency,o."supplierName" INTO r FROM "GoodsReceipt" g JOIN "PurchaseOrder" o ON o.id=g."orderId" WHERE g.id=NEW."receiptId" AND g."tenantId"=NEW."tenantId" FOR UPDATE OF g;
 SELECT * INTO j FROM "JournalEntry" WHERE id=NEW."entryId";
 SELECT * INTO p FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 IF r.id IS NULL OR r."companyId"<>NEW."companyId" OR j.id IS NULL OR j."tenantId"<>NEW."tenantId" OR j."companyId"<>NEW."companyId" OR j."branchId" IS DISTINCT FROM r."branchId" OR j.currency<>'OMR' OR r.currency<>'OMR' OR j."reversalOf" IS NOT NULL OR j."creationTransaction"<>(txid_current())::text OR j."entryDate"<r."createdAt"::date THEN RAISE EXCEPTION 'Invalid or late purchase VAT snapshot' USING ERRCODE='23514'; END IF;
 IF NEW."returnId" IS NULL THEN
  IF p.enabled IS DISTINCT FROM true OR r."createdAt"::date<p."effectiveFrom" OR NEW."supplierName"<>r."supplierName" OR (NEW."recoverableTax">0 AND NEW."inputAccountId" IS DISTINCT FROM p."inputAccountId") OR j.number !~ '^SYSG-[0-9A-Z]{25}$' THEN RAISE EXCEPTION 'Purchase VAT requires registered OMR profile' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.details)<>(SELECT count(*) FROM "GoodsReceiptLine" WHERE "receiptId"=r.id) THEN RAISE EXCEPTION 'Classify every receipt line' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO original FROM "PurchaseVat" WHERE "receiptId"=r.id AND "returnId" IS NULL;
  IF original."entryId" IS NULL OR NEW."inputAccountId" IS DISTINCT FROM original."inputAccountId" OR NEW."supplierName"<>original."supplierName" OR NEW."supplierTaxNumber"<>original."supplierTaxNumber" OR j.number !~ '^SYST-[0-9A-Z]{25}$' OR NOT EXISTS(SELECT 1 FROM "GoodsReturn" WHERE id=NEW."returnId" AND "receiptId"=r.id AND j."entryDate">="createdAt"::date) OR EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reversalOf"=original."entryId") THEN RAISE EXCEPTION 'Return VAT requires active original snapshot' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.details)<>(SELECT count(*) FROM "GoodsReturnLine" WHERE "returnId"=NEW."returnId") THEN RAISE EXCEPTION 'Classify every return line' USING ERRCODE='23514'; END IF;
 END IF;
 IF jsonb_array_length(NEW.details)<1 THEN RAISE EXCEPTION 'Empty VAT details' USING ERRCODE='23514'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(NEW.details) LOOP
  IF jsonb_typeof(d)<>'object' OR NOT(d ?& ARRAY['receiptLineId','quantity','net','tax','treatment','recoverable']) OR d->>'treatment' IS NULL OR d->>'treatment' NOT IN('STANDARD','ZERO','EXEMPT') OR jsonb_typeof(d->'recoverable')<>'boolean' THEN RAISE EXCEPTION 'Invalid purchase classification' USING ERRCODE='23514'; END IF;
  line_id:=(d->>'receiptLineId')::uuid;qty:=(d->>'quantity')::numeric;n:=(d->>'net')::numeric;t:=(d->>'tax')::numeric;deductible:=(d->>'recoverable')::boolean;
  IF line_id IS NULL OR qty IS NULL OR n IS NULL OR t IS NULL OR qty<=0 OR n<0 OR t<0 OR line_id=ANY(seen) OR (deductible AND d->>'treatment'<>'STANDARD') OR NOT EXISTS(SELECT 1 FROM "GoodsReceiptLine" l JOIN "PurchaseOrderLine" ol ON ol.id=l."orderLineId" WHERE l.id=line_id AND l."receiptId"=r.id AND n=qty*ol."unitPrice") THEN RAISE EXCEPTION 'Purchase VAT does not match source' USING ERRCODE='23514'; END IF;
  IF NEW."returnId" IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM "GoodsReceiptLine" WHERE id=line_id AND quantity=qty) OR t<>(CASE d->>'treatment' WHEN 'STANDARD' THEN round(n*0.05,3) ELSE 0 END) THEN RAISE EXCEPTION 'Receipt tax mismatch' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT value INTO original_d FROM jsonb_array_elements(original.details) WHERE value->>'receiptLineId'=line_id::text;
   SELECT COALESCE(sum((v->>'quantity')::numeric),0) INTO prior_qty FROM "PurchaseVat" pv CROSS JOIN LATERAL jsonb_array_elements(pv.details) v WHERE pv."receiptId"=r.id AND pv."returnId" IS NOT NULL AND v->>'receiptLineId'=line_id::text;
   IF original_d IS NULL OR d->>'treatment'<>original_d->>'treatment' OR deductible IS DISTINCT FROM (original_d->>'recoverable')::boolean OR NOT EXISTS(SELECT 1 FROM "GoodsReturnLine" WHERE "returnId"=NEW."returnId" AND "receiptLineId"=line_id AND quantity=qty) OR prior_qty+qty>(original_d->>'quantity')::numeric OR t<>round((original_d->>'tax')::numeric*(prior_qty+qty)/(original_d->>'quantity')::numeric,3)-round((original_d->>'tax')::numeric*prior_qty/(original_d->>'quantity')::numeric,3) THEN RAISE EXCEPTION 'Return VAT allocation mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  seen:=array_append(seen,line_id);sum_net:=sum_net+n;sum_tax:=sum_tax+t;IF deductible THEN sum_input:=sum_input+t;END IF;
 END LOOP;
 IF sum_net<>NEW."netAmount" OR sum_tax<>NEW."taxAmount" OR sum_input<>NEW."recoverableTax" OR j.total<>sum_net+sum_tax THEN RAISE EXCEPTION 'Purchase VAT totals mismatch' USING ERRCODE='23514'; END IF;
 SELECT "accountId" INTO purchase_account FROM "JournalLine" WHERE "entryId"=j.id AND position=CASE WHEN NEW."returnId" IS NULL THEN 0 ELSE 1 END;
 SELECT "accountId" INTO payable_account FROM "JournalLine" WHERE "entryId"=j.id AND position=CASE WHEN NEW."returnId" IS NULL THEN 1 ELSE 0 END;
 IF NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=purchase_account AND type IN('ASSET','EXPENSE')) OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=payable_account AND type='LIABILITY') OR purchase_account=payable_account OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=j.id)<>(CASE WHEN sum_input>0 THEN 3 ELSE 2 END) THEN RAISE EXCEPTION 'Purchase tax account shape mismatch' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND "accountId"=purchase_account AND (CASE WHEN NEW."returnId" IS NULL THEN debit=sum_net+sum_tax-sum_input AND credit=0 ELSE credit=sum_net+sum_tax-sum_input AND debit=0 END)) OR NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND "accountId"=payable_account AND (CASE WHEN NEW."returnId" IS NULL THEN credit=j.total AND debit=0 ELSE debit=j.total AND credit=0 END)) THEN RAISE EXCEPTION 'Purchase VAT journal mismatch' USING ERRCODE='23514'; END IF;
 IF sum_input>0 AND (NEW."inputAccountId" IS NULL OR NEW."inputAccountId" IN(purchase_account,payable_account) OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=NEW."inputAccountId" AND type='ASSET') OR NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND position=2 AND "accountId"=NEW."inputAccountId" AND (CASE WHEN NEW."returnId" IS NULL THEN debit=sum_input AND credit=0 ELSE credit=sum_input AND debit=0 END))) THEN RAISE EXCEPTION 'Input VAT journal mismatch' USING ERRCODE='23514'; END IF;
 IF NEW."returnId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=original."entryId" AND position=0 AND "accountId"=purchase_account) THEN RAISE EXCEPTION 'Use original purchase account' USING ERRCODE='23514'; END IF;
 IF NEW."returnId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=original."entryId" AND position=1 AND "accountId"=payable_account) THEN RAISE EXCEPTION 'Use original supplier payable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_vat_validate BEFORE INSERT ON "PurchaseVat" FOR EACH ROW EXECUTE FUNCTION erp_validate_purchase_vat();
CREATE TRIGGER purchase_vat_immutable BEFORE UPDATE OR DELETE ON "PurchaseVat" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_require_purchase_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD; original_id UUID; entry_id UUID;
BEGIN
 IF NEW.action NOT IN('purchase-receipt.ledger_posted','purchase-return.ledger_posted') THEN RETURN NULL;END IF;
 entry_id:=(NEW.metadata->>'journalId')::uuid;
 IF NEW.action='purchase-receipt.ledger_posted' THEN
  SELECT g.id,g."companyId",g."createdAt" INTO r FROM "GoodsReceipt" g WHERE g.id=NEW."entityId"::uuid AND g."tenantId"=NEW."tenantId";
  IF EXISTS(SELECT 1 FROM "CompanyVatProfile" p WHERE p."companyId"=r."companyId" AND enabled AND r."createdAt"::date>=p."effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "PurchaseVat" WHERE "entryId"=entry_id AND "receiptId"=r.id AND "returnId" IS NULL) THEN RAISE EXCEPTION 'Registered purchase posting requires VAT snapshot' USING ERRCODE='23514';END IF;
 ELSE
  SELECT "receiptId" INTO original_id FROM "GoodsReturn" WHERE id=NEW."entityId"::uuid AND "tenantId"=NEW."tenantId";
  IF EXISTS(SELECT 1 FROM "PurchaseVat" WHERE "receiptId"=original_id AND "returnId" IS NULL) AND NOT EXISTS(SELECT 1 FROM "PurchaseVat" WHERE "entryId"=entry_id AND "returnId"=NEW."entityId"::uuid) THEN RAISE EXCEPTION 'Purchase return requires original VAT allocation' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_vat_required AFTER INSERT ON "AuditLog" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_require_purchase_vat();
ALTER TABLE "PurchaseVat" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PurchaseVat" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erp_validate_purchase_vat(),erp_require_purchase_vat() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PurchaseVat" FROM anon;END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PurchaseVat" FROM authenticated;END IF;
END $$;
