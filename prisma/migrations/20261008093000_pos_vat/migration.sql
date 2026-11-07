ALTER TABLE "PosOrder" ADD COLUMN "creationTransaction" TEXT NOT NULL DEFAULT txid_current()::text;
CREATE TABLE "PosVat" (
 "orderId" UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,
 "netAmount" NUMERIC(18,3) NOT NULL CHECK("netAmount">0),"taxAmount" NUMERIC(18,3) NOT NULL CHECK("taxAmount">=0),
 "outputAccountId" UUID NOT NULL,"taxNumber" VARCHAR(40) NOT NULL CHECK(length(trim("taxNumber")) BETWEEN 3 AND 40),"sellerName" VARCHAR(200) NOT NULL CHECK(length(trim("sellerName")) BETWEEN 2 AND 200),"sellerAddress" VARCHAR(500) NOT NULL CHECK(length(trim("sellerAddress")) BETWEEN 3 AND 500),"details" JSONB NOT NULL CHECK(jsonb_typeof(details)='array'),
 FOREIGN KEY("tenantId","companyId","orderId") REFERENCES "PosOrder"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","outputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "PosVat_tenantId_companyId_orderId_key" ON "PosVat"("tenantId","companyId","orderId");
CREATE INDEX "PosVat_tenantId_companyId_idx" ON "PosVat"("tenantId","companyId");
CREATE FUNCTION erp_validate_pos_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o "PosOrder"%ROWTYPE; p "CompanyVatProfile"%ROWTYPE; d JSONB; pos INTEGER; n NUMERIC; t NUMERIC; sum_net NUMERIC:=0;sum_tax NUMERIC:=0; seen INTEGER[]:=ARRAY[]::INTEGER[];
BEGIN
 SELECT * INTO o FROM "PosOrder" WHERE id=NEW."orderId" FOR UPDATE;
 SELECT * INTO p FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 IF o.id IS NULL OR o."tenantId"<>NEW."tenantId" OR o."companyId"<>NEW."companyId" OR o.currency<>'OMR' OR o.status<>'OPEN' OR o."creationTransaction"<>txid_current()::text OR p.enabled IS DISTINCT FROM true OR p."effectiveFrom" IS NULL OR o."createdAt"::date<p."effectiveFrom" OR ROW(NEW."outputAccountId",NEW."taxNumber",NEW."sellerName",NEW."sellerAddress") IS DISTINCT FROM ROW(p."outputAccountId",p."taxNumber",p."sellerName",p."sellerAddress") THEN RAISE EXCEPTION 'Invalid or late POS VAT snapshot' USING ERRCODE='23514';END IF;
 IF jsonb_array_length(NEW.details)<1 OR jsonb_array_length(NEW.details)<>(SELECT count(*) FROM "PosOrderLine" WHERE "orderId"=o.id) OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=NEW."outputAccountId" AND type='LIABILITY') THEN RAISE EXCEPTION 'Classify every POS line with scoped output VAT account' USING ERRCODE='23514';END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(NEW.details) LOOP
  IF jsonb_typeof(d)<>'object' OR NOT(d ?& ARRAY['position','treatment','net','tax']) OR d->>'treatment' IS NULL OR d->>'treatment' NOT IN('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Invalid POS VAT treatment' USING ERRCODE='23514';END IF;
  pos:=(d->>'position')::integer;n:=(d->>'net')::numeric;t:=(d->>'tax')::numeric;
  IF pos IS NULL OR n IS NULL OR t IS NULL OR pos=ANY(seen) OR NOT EXISTS(SELECT 1 FROM "PosOrderLine" WHERE "orderId"=o.id AND position=pos AND amount=n) OR t<>(CASE WHEN d->>'treatment'='STANDARD' THEN round(n*0.05,3) ELSE 0 END) THEN RAISE EXCEPTION 'POS VAT line amount mismatch' USING ERRCODE='23514';END IF;
  seen:=array_append(seen,pos);sum_net:=sum_net+n;sum_tax:=sum_tax+t;
 END LOOP;
 IF NEW."netAmount"<>sum_net OR NEW."taxAmount"<>sum_tax OR o.total<>sum_net+sum_tax THEN RAISE EXCEPTION 'POS VAT totals mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_vat_validate BEFORE INSERT ON "PosVat" FOR EACH ROW EXECUTE FUNCTION erp_validate_pos_vat();
CREATE TRIGGER pos_vat_immutable BEFORE UPDATE OR DELETE ON "PosVat" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE OR REPLACE FUNCTION verify_pos_total() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target UUID; expected NUMERIC; actual NUMERIC; line_count BIGINT; tax NUMERIC;
BEGIN
 IF TG_TABLE_NAME='PosOrder' THEN target:=NEW.id;ELSE target:=NEW."orderId";END IF;
 SELECT total INTO expected FROM "PosOrder" WHERE id=target;
 SELECT COALESCE(sum(amount),0),count(*) INTO actual,line_count FROM "PosOrderLine" WHERE "orderId"=target;
 SELECT COALESCE((SELECT "taxAmount" FROM "PosVat" WHERE "orderId"=target),0) INTO tax;
 IF line_count<1 OR actual+tax<>expected THEN RAISE EXCEPTION 'POS order total must match net lines plus saved VAT' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION erp_require_pos_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId" AND enabled AND NEW."createdAt"::date>="effectiveFrom") AND NOT EXISTS(SELECT 1 FROM "PosVat" WHERE "orderId"=NEW.id) THEN RAISE EXCEPTION 'Registered POS order requires original VAT snapshot' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_vat_required AFTER INSERT ON "PosOrder" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_require_pos_vat();
CREATE FUNCTION erp_pos_line_original_transaction() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "PosOrder" WHERE id=NEW."orderId" AND "creationTransaction"=txid_current()::text) THEN RAISE EXCEPTION 'POS lines require original creation transaction' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_line_original_transaction BEFORE INSERT ON "PosOrderLine" FOR EACH ROW EXECUTE FUNCTION erp_pos_line_original_transaction();
CREATE FUNCTION erp_validate_pos_journal() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_id UUID; o "PosOrder"%ROWTYPE; v "PosVat"%ROWTYPE; net NUMERIC; tax NUMERIC;
BEGIN
 IF NEW.number !~ '^SYSP-' THEN RETURN NULL;END IF;
 SELECT a."entityId"::uuid INTO source_id FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a.entity='PosOrder' AND a.action='pos.ledger_posted' AND a.metadata->>'journalId'=NEW.id::text AND NEW.number=erp_purchase_document_number('SYSP',a."entityId"::uuid);
 SELECT * INTO o FROM "PosOrder" WHERE id=source_id;
 SELECT * INTO v FROM "PosVat" WHERE "orderId"=source_id;
 IF source_id IS NULL OR o.id IS NULL OR ROW(NEW."tenantId",NEW."companyId",NEW."branchId",NEW.currency,NEW.total) IS DISTINCT FROM ROW(o."tenantId",o."companyId",o."branchId",o.currency,o.total) OR o.status<>'PAID' OR NEW."reversalOf" IS NOT NULL OR NEW."entryDate"<o."paidAt"::date THEN RAISE EXCEPTION 'POS journal requires matching paid source' USING ERRCODE='23514';END IF;
 tax:=COALESCE(v."taxAmount",0);net:=o.total-tax;
 IF (SELECT count(*) FROM "JournalLine" WHERE "entryId"=NEW.id)<>(CASE WHEN tax>0 THEN 3 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."entryId"=NEW.id AND l.position=0 AND a.type='ASSET' AND l.debit=o.total AND l.credit=0) OR NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "LedgerAccount" a ON a.id=l."accountId" WHERE l."entryId"=NEW.id AND l.position=1 AND a.type='REVENUE' AND l.credit=net AND l.debit=0) OR (tax>0 AND NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=NEW.id AND position=2 AND "accountId"=v."outputAccountId" AND credit=tax AND debit=0)) THEN RAISE EXCEPTION 'POS journal must separate gross, net revenue and VAT' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_journal_vat_validate AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_validate_pos_journal();
ALTER TABLE "PosVat" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PosVat" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PosVat" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_validate_pos_vat(),verify_pos_total(),erp_require_pos_vat(),erp_pos_line_original_transaction(),erp_validate_pos_journal() FROM PUBLIC;
