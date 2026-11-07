CREATE UNIQUE INDEX "JournalLine_tenantId_companyId_accountId_id_key" ON "JournalLine"("tenantId","companyId","accountId",id);
CREATE TABLE "BankStatement" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,
 reference VARCHAR(120) NOT NULL,"from" DATE NOT NULL,"to" DATE NOT NULL,opening DECIMAL(18,3) NOT NULL,closing DECIMAL(18,3) NOT NULL,
 currency VARCHAR(3) NOT NULL,"requestHash" VARCHAR(64) NOT NULL,"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("from"<="to" AND "to"-"from"<366),CHECK(length(trim(reference)) BETWEEN 3 AND 120),
 FOREIGN KEY ("tenantId","companyId","accountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BankStatement_tenantId_companyId_accountId_id_key" ON "BankStatement"("tenantId","companyId","accountId",id);
CREATE UNIQUE INDEX "BankStatement_accountId_reference_key" ON "BankStatement"("accountId",reference);
CREATE INDEX "BankStatement_tenantId_companyId_accountId_to_idx" ON "BankStatement"("tenantId","companyId","accountId","to");
CREATE TABLE "BankStatementLine" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,"statementId" UUID NOT NULL,
 position INTEGER NOT NULL,"bookingDate" DATE NOT NULL,reference VARCHAR(120) NOT NULL,amount DECIMAL(18,3) NOT NULL,
 CHECK(position>=0),CHECK(amount<>0),CHECK(length(trim(reference)) BETWEEN 1 AND 120),
 FOREIGN KEY ("tenantId","companyId","accountId","statementId") REFERENCES "BankStatement"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BankStatementLine_tenantId_companyId_accountId_id_key" ON "BankStatementLine"("tenantId","companyId","accountId",id);
CREATE UNIQUE INDEX "BankStatementLine_statementId_position_key" ON "BankStatementLine"("statementId",position);
CREATE INDEX "BankStatementLine_tenantId_companyId_accountId_bookingDate_idx" ON "BankStatementLine"("tenantId","companyId","accountId","bookingDate");
CREATE TABLE "BankMatch" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,"bankLineId" UUID NOT NULL,"journalLineId" UUID NOT NULL,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"cancelledAt" TIMESTAMP(3),"cancelledBy" UUID,"cancelReason" VARCHAR(300),
 CHECK (("cancelledAt" IS NULL AND "cancelledBy" IS NULL AND "cancelReason" IS NULL) OR ("cancelledAt" IS NOT NULL AND "cancelledBy" IS NOT NULL AND length(trim("cancelReason")) BETWEEN 3 AND 300)),
 FOREIGN KEY ("tenantId","companyId","accountId","bankLineId") REFERENCES "BankStatementLine"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("tenantId","companyId","accountId","journalLineId") REFERENCES "JournalLine"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BankMatch_tenantId_companyId_accountId_createdAt_idx" ON "BankMatch"("tenantId","companyId","accountId","createdAt");
CREATE UNIQUE INDEX bank_match_active_bank ON "BankMatch"("bankLineId") WHERE "cancelledAt" IS NULL;
CREATE UNIQUE INDEX bank_match_active_journal ON "BankMatch"("journalLineId") WHERE "cancelledAt" IS NULL;
CREATE FUNCTION erp_validate_bank_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='ASSET' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" AND "baseCurrency"=NEW.currency) THEN RAISE EXCEPTION 'Bank account or currency mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "BankStatement" WHERE "accountId"=NEW."accountId" AND "from"<=NEW."to" AND "to">=NEW."from") THEN RAISE EXCEPTION 'Bank statement period overlaps an existing statement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION erp_validate_bank_statement_total() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE sid UUID; s RECORD; total NUMERIC; n INTEGER;
BEGIN
 IF TG_TABLE_NAME='BankStatement' THEN sid:=NEW.id; ELSE sid:=NEW."statementId"; END IF;
 SELECT * INTO s FROM "BankStatement" WHERE id=sid;
 SELECT count(*),COALESCE(sum(amount),0) INTO n,total FROM "BankStatementLine" WHERE "statementId"=sid;
 IF n>500 OR s.opening+total<>s.closing OR EXISTS(SELECT 1 FROM "BankStatementLine" WHERE "statementId"=sid AND ("bookingDate"<s."from" OR "bookingDate">s."to")) THEN RAISE EXCEPTION 'Statement total or line date mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION erp_validate_bank_line_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "BankStatement" WHERE id=NEW."statementId" AND "createdAt"=CAST(transaction_timestamp() AS TIMESTAMP(3))) THEN RAISE EXCEPTION 'Bank statements cannot be extended after import' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION erp_validate_bank_match() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b RECORD; j RECORD;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."cancelledAt" IS NOT NULL OR NEW."cancelledAt" IS NULL OR (to_jsonb(NEW)-ARRAY['cancelledAt','cancelledBy','cancelReason'])<>(to_jsonb(OLD)-ARRAY['cancelledAt','cancelledBy','cancelReason']) THEN RAISE EXCEPTION 'Bank matches only permit one audited cancellation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" FOR UPDATE;
 SELECT l.amount,s.currency,s."to" INTO b FROM "BankStatementLine" l JOIN "BankStatement" s ON s.id=l."statementId" WHERE l.id=NEW."bankLineId";
 SELECT l.debit-l.credit amount,e.currency,e."entryDate" INTO j FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" WHERE l.id=NEW."journalLineId";
 IF NEW."cancelledAt" IS NOT NULL OR b.amount IS NULL OR j.amount IS NULL OR b.amount<>j.amount OR b.currency<>j.currency OR j."entryDate">b."to" THEN RAISE EXCEPTION 'Bank match amount, direction, currency or date mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_statement_validate BEFORE INSERT ON "BankStatement" FOR EACH ROW EXECUTE FUNCTION erp_validate_bank_statement();
CREATE CONSTRAINT TRIGGER bank_statement_total AFTER INSERT ON "BankStatement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_validate_bank_statement_total();
CREATE CONSTRAINT TRIGGER bank_statement_line_total AFTER INSERT ON "BankStatementLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_validate_bank_statement_total();
CREATE TRIGGER bank_statement_immutable BEFORE UPDATE OR DELETE ON "BankStatement" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE TRIGGER bank_statement_line_insert BEFORE INSERT ON "BankStatementLine" FOR EACH ROW EXECUTE FUNCTION erp_validate_bank_line_insert();
CREATE TRIGGER bank_statement_line_immutable BEFORE UPDATE OR DELETE ON "BankStatementLine" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE TRIGGER bank_match_validate BEFORE INSERT OR UPDATE ON "BankMatch" FOR EACH ROW EXECUTE FUNCTION erp_validate_bank_match();
CREATE TRIGGER bank_match_no_delete BEFORE DELETE ON "BankMatch" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
REVOKE EXECUTE ON FUNCTION erp_validate_bank_statement(),erp_validate_bank_statement_total(),erp_validate_bank_match(),erp_validate_bank_line_insert() FROM PUBLIC;
ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatementLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankMatch" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BankStatement","BankStatementLine","BankMatch" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "BankStatement","BankStatementLine","BankMatch" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "BankStatement","BankStatementLine","BankMatch" FROM authenticated; END IF;
END $$;
