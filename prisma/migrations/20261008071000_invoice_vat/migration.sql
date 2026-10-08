CREATE TABLE "CompanyVatProfile" (
 "companyId" UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"revision" INTEGER NOT NULL DEFAULT 1,
 "enabled" BOOLEAN NOT NULL DEFAULT false,"taxNumber" VARCHAR(40),"sellerName" VARCHAR(200),"sellerAddress" VARCHAR(500),"effectiveFrom" DATE,"outputAccountId" UUID,
 CHECK ("revision">0),
 CHECK (NOT "enabled" OR ("taxNumber" IS NOT NULL AND length(trim("taxNumber")) BETWEEN 3 AND 40 AND "sellerName" IS NOT NULL AND length(trim("sellerName")) BETWEEN 2 AND 200 AND "sellerAddress" IS NOT NULL AND length(trim("sellerAddress")) BETWEEN 3 AND 500 AND "effectiveFrom" IS NOT NULL AND "outputAccountId" IS NOT NULL)),
 FOREIGN KEY ("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY ("tenantId","companyId","outputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "CompanyVatProfile_tenantId_companyId_key" ON "CompanyVatProfile"("tenantId","companyId");
ALTER TABLE "Invoice" ADD COLUMN "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text;
CREATE TABLE "InvoiceVat" (
 "invoiceId" UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,
 "taxAmount" NUMERIC(18,3) NOT NULL CHECK ("taxAmount">=0),"outputAccountId" UUID NOT NULL,
 "taxNumber" VARCHAR(40) NOT NULL,"sellerName" VARCHAR(200) NOT NULL,"sellerAddress" VARCHAR(500) NOT NULL,
 "details" JSONB NOT NULL CHECK (jsonb_typeof(details)='array'),
 FOREIGN KEY ("tenantId","companyId","invoiceId") REFERENCES "Invoice"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY ("tenantId","companyId","outputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "InvoiceVat_tenantId_companyId_invoiceId_key" ON "InvoiceVat"("tenantId","companyId","invoiceId");
CREATE INDEX "InvoiceVat_tenantId_companyId_idx" ON "InvoiceVat"("tenantId","companyId");
CREATE FUNCTION erp_vat_company_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='CompanyVatProfile' THEN
 IF NEW.enabled THEN
  IF NOT EXISTS(SELECT 1 FROM "Company" WHERE id=NEW."companyId" AND "baseCurrency"='OMR') OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=NEW."outputAccountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='LIABILITY') THEN RAISE EXCEPTION 'Oman VAT requires OMR and a company liability account' USING ERRCODE='23514'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vat_profile_validate BEFORE INSERT OR UPDATE ON "CompanyVatProfile" FOR EACH ROW EXECUTE FUNCTION erp_vat_company_lock();
CREATE TRIGGER invoice_vat_company_lock BEFORE INSERT ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_vat_company_lock();
CREATE FUNCTION erp_validate_invoice_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE i RECORD; p RECORD; d JSONB; n NUMERIC; t NUMERIC; total_tax NUMERIC:=0; total_net NUMERIC:=0; seen INTEGER[]:=ARRAY[]::INTEGER[]; pos INTEGER;
BEGIN
 SELECT * INTO i FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT * INTO p FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 IF i.id IS NULL OR i."companyId"<>NEW."companyId" OR i."creationTransaction"<>(txid_current())::text OR i.currency<>'OMR' OR i.status<>'DRAFT' OR p.enabled IS DISTINCT FROM true OR i."createdAt"::date<p."effectiveFrom" OR NEW."outputAccountId"<>p."outputAccountId" OR NEW."taxNumber"<>p."taxNumber" OR NEW."sellerName"<>p."sellerName" OR NEW."sellerAddress"<>p."sellerAddress" THEN RAISE EXCEPTION 'Invalid or late invoice VAT snapshot' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.details)<1 OR jsonb_array_length(NEW.details)<>(SELECT count(*) FROM "InvoiceLine" WHERE "invoiceId"=i.id) THEN RAISE EXCEPTION 'VAT must classify every invoice line' USING ERRCODE='23514'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(NEW.details) LOOP
  IF jsonb_typeof(d)<>'object' OR NOT (d ?& ARRAY['position','treatment','net','tax']) OR d->>'treatment' IS NULL OR d->>'treatment' NOT IN ('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Invalid tax classification' USING ERRCODE='23514'; END IF;
  pos:=(d->>'position')::integer; n:=(d->>'net')::numeric; t:=(d->>'tax')::numeric;
  IF n IS NULL OR t IS NULL OR pos IS NULL OR n<0 OR t<0 OR pos<0 OR pos=ANY(seen) OR NOT EXISTS(SELECT 1 FROM "InvoiceLine" WHERE "invoiceId"=i.id AND position=pos AND amount=n) OR t<>(CASE d->>'treatment' WHEN 'STANDARD' THEN round(n*0.05,3) ELSE 0 END) THEN RAISE EXCEPTION 'Invoice tax amounts do not match lines' USING ERRCODE='23514'; END IF;
  seen:=array_append(seen,pos);total_tax:=total_tax+t;total_net:=total_net+n;
 END LOOP;
 IF total_tax<>NEW."taxAmount" OR total_net<>i.subtotal THEN RAISE EXCEPTION 'Invoice VAT totals mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_vat_validate BEFORE INSERT ON "InvoiceVat" FOR EACH ROW EXECUTE FUNCTION erp_validate_invoice_vat();
CREATE TRIGGER invoice_vat_immutable BEFORE UPDATE OR DELETE ON "InvoiceVat" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_require_invoice_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId" AND enabled AND NEW."createdAt"::date>="effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "InvoiceVat" WHERE "invoiceId"=NEW.id) THEN RAISE EXCEPTION 'Registered company invoice requires VAT classification' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoice_vat_required AFTER INSERT ON "Invoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_require_invoice_vat();
ALTER TABLE "CompanyVatProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoiceVat" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CompanyVatProfile","InvoiceVat" FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION erp_vat_company_lock(),erp_validate_invoice_vat(),erp_require_invoice_vat() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CompanyVatProfile","InvoiceVat" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CompanyVatProfile","InvoiceVat" FROM authenticated; END IF;
END $$;
CREATE OR REPLACE FUNCTION erp_validate_customer_settlement() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE invoice RECORD; original RECORD; receivable UUID; net NUMERIC; journal RECORD; latest DATE;
BEGIN
 SELECT * INTO invoice FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT j.* INTO original FROM "AuditLog" a JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid
 WHERE a."tenantId"=NEW."tenantId" AND a.entity='Invoice' AND a."entityId"=NEW."invoiceId"::text AND a.action='invoice.ledger_posted'
 AND j."tenantId"=NEW."tenantId" AND j."companyId"=NEW."companyId"
 AND NOT EXISTS (SELECT 1 FROM "JournalEntry" rev WHERE rev."reversalOf"=j.id);
 IF invoice.id IS NULL OR invoice.status<>'ISSUED' OR original.id IS NULL OR original.total<>invoice.subtotal+COALESCE((SELECT "taxAmount" FROM "InvoiceVat" WHERE "invoiceId"=invoice.id),0) OR
 original.currency<>invoice.currency OR original."branchId" IS DISTINCT FROM invoice."branchId" OR NEW."branchId" IS DISTINCT FROM invoice."branchId" THEN
 RAISE EXCEPTION 'An active issued invoice journal with matching scope is required' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM "InvoiceVat" v WHERE v."invoiceId"=invoice.id AND v."taxAmount">0 AND (
 NOT EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId"=original.id AND l.position=2 AND l."accountId"=v."outputAccountId" AND l.credit=v."taxAmount" AND l.debit=0) OR
 NOT EXISTS (SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."entryId"=original.id AND l.position=1 AND l.credit=invoice.subtotal AND l.debit=0 AND a.type='REVENUE')
 )) THEN RAISE EXCEPTION 'Invoice revenue and VAT journal mismatch' USING ERRCODE='23514'; END IF;
 SELECT l."accountId" INTO receivable FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId"
 WHERE l."entryId"=original.id AND l.position=0 AND l.debit=original.total AND l.credit=0 AND a.type='ASSET';
 SELECT * INTO journal FROM "JournalEntry" WHERE id=NEW."entryId";
 IF receivable IS NULL OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=original.id)<>(CASE WHEN COALESCE((SELECT "taxAmount" FROM "InvoiceVat" WHERE "invoiceId"=invoice.id),0)>0 THEN 3 ELSE 2 END) OR
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
CREATE OR REPLACE FUNCTION erp_validate_customer_correction() RETURNS trigger
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
 SELECT subtotal+COALESCE((SELECT "taxAmount" FROM "InvoiceVat" WHERE "invoiceId"=invoice_id),0) INTO invoice_total FROM "Invoice" WHERE id=invoice_id AND "tenantId"=NEW."tenantId" FOR UPDATE;
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

CREATE FUNCTION erp_invoice_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='Invoice' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoice history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','issuedAt','voidedAt','voidReason'])<>(to_jsonb(OLD)-ARRAY['status','issuedAt','voidedAt','voidReason']) THEN RAISE EXCEPTION 'Invoice financial snapshot is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Invoice line snapshot is immutable' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" AND "creationTransaction"=(txid_current())::text AND status='DRAFT') THEN RAISE EXCEPTION 'Invoice lines must be saved in the original transaction' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_snapshot_guard BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_invoice_snapshot_guard();
CREATE TRIGGER invoice_line_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION erp_invoice_snapshot_guard();
REVOKE EXECUTE ON FUNCTION erp_invoice_snapshot_guard() FROM PUBLIC;
