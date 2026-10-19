ALTER TABLE "BankStatement" ADD COLUMN "voidedAt" TIMESTAMP(3),ADD COLUMN "voidedBy" UUID,ADD COLUMN "voidReason" VARCHAR(300);
ALTER TABLE "BankStatement" ADD CONSTRAINT bank_statement_void_fields CHECK(("voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND length(trim("voidReason")) BETWEEN 3 AND 300));
CREATE OR REPLACE FUNCTION erp_validate_bank_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='ASSET' FOR UPDATE;
 IF NOT FOUND OR NEW."voidedAt" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" AND "baseCurrency"=NEW.currency) THEN RAISE EXCEPTION 'Bank account or currency mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "BankStatement" WHERE "accountId"=NEW."accountId" AND "voidedAt" IS NULL AND "from"<=NEW."to" AND "to">=NEW."from") THEN RAISE EXCEPTION 'Bank statement period overlaps an existing statement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION erp_bank_statement_correction() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bank statement history cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "LedgerAccount" WHERE id=OLD."accountId" FOR UPDATE;
 IF OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['voidedAt','voidedBy','voidReason'])<>(to_jsonb(OLD)-ARRAY['voidedAt','voidedBy','voidReason']) THEN RAISE EXCEPTION 'Only a one-time bank statement void is allowed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE l."statementId"=OLD.id AND m."cancelledAt" IS NULL) THEN RAISE EXCEPTION 'Cancel active matches before voiding a statement' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER bank_statement_immutable ON "BankStatement";
CREATE TRIGGER bank_statement_immutable BEFORE UPDATE OR DELETE ON "BankStatement" FOR EACH ROW EXECUTE FUNCTION erp_bank_statement_correction();
CREATE OR REPLACE FUNCTION erp_validate_bank_match() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b RECORD; j RECORD;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD."cancelledAt" IS NOT NULL OR NEW."cancelledAt" IS NULL OR (to_jsonb(NEW)-ARRAY['cancelledAt','cancelledBy','cancelReason'])<>(to_jsonb(OLD)-ARRAY['cancelledAt','cancelledBy','cancelReason']) THEN RAISE EXCEPTION 'Bank matches only permit one audited cancellation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" FOR UPDATE;
 SELECT l.amount,s.currency,s."to" INTO b FROM "BankStatementLine" l JOIN "BankStatement" s ON s.id=l."statementId" WHERE l.id=NEW."bankLineId" AND s."voidedAt" IS NULL;
 SELECT l.debit-l.credit amount,e.currency,e."entryDate" INTO j FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" WHERE l.id=NEW."journalLineId";
 IF NEW."cancelledAt" IS NOT NULL OR b.amount IS NULL OR j.amount IS NULL OR b.amount<>j.amount OR b.currency<>j.currency OR j."entryDate">b."to" THEN RAISE EXCEPTION 'Bank match source, amount, direction, currency or date mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_bank_statement_correction(),erp_validate_bank_statement(),erp_validate_bank_match() FROM PUBLIC;
