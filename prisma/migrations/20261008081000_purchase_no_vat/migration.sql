ALTER TABLE "PurchaseVat" ALTER COLUMN "supplierTaxNumber" DROP NOT NULL;
ALTER TABLE "PurchaseVat" ADD CONSTRAINT "PurchaseVat_standard_supplier_registration" CHECK (NOT (details @> '[{"treatment":"STANDARD"}]'::jsonb) OR "supplierTaxNumber" IS NOT NULL);
CREATE OR REPLACE FUNCTION erp_validate_purchase_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
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
  IF original."entryId" IS NULL OR NEW."inputAccountId" IS DISTINCT FROM original."inputAccountId" OR NEW."supplierName"<>original."supplierName" OR NEW."supplierTaxNumber" IS DISTINCT FROM original."supplierTaxNumber" OR j.number !~ '^SYST-[0-9A-Z]{25}$' OR NOT EXISTS(SELECT 1 FROM "GoodsReturn" WHERE id=NEW."returnId" AND "receiptId"=r.id AND j."entryDate">="createdAt"::date) OR EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reversalOf"=original."entryId") THEN RAISE EXCEPTION 'Return VAT requires active original snapshot' USING ERRCODE='23514'; END IF;
  IF jsonb_array_length(NEW.details)<>(SELECT count(*) FROM "GoodsReturnLine" WHERE "returnId"=NEW."returnId") THEN RAISE EXCEPTION 'Classify every return line' USING ERRCODE='23514'; END IF;
 END IF;
 IF jsonb_array_length(NEW.details)<1 THEN RAISE EXCEPTION 'Empty VAT details' USING ERRCODE='23514'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(NEW.details) LOOP
  IF jsonb_typeof(d)<>'object' OR NOT(d ?& ARRAY['receiptLineId','quantity','net','tax','treatment','recoverable']) OR d->>'treatment' IS NULL OR d->>'treatment' NOT IN('STANDARD','ZERO','EXEMPT','NO_VAT') OR jsonb_typeof(d->'recoverable')<>'boolean' THEN RAISE EXCEPTION 'Invalid purchase classification' USING ERRCODE='23514'; END IF;
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
CREATE FUNCTION erp_validate_input_vat_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."inputAccountId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=NEW."inputAccountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='ASSET') THEN RAISE EXCEPTION 'Input VAT requires a company asset account' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vat_input_profile_validate BEFORE INSERT OR UPDATE ON "CompanyVatProfile" FOR EACH ROW EXECUTE FUNCTION erp_validate_input_vat_profile();
REVOKE EXECUTE ON FUNCTION erp_validate_input_vat_profile() FROM PUBLIC;
