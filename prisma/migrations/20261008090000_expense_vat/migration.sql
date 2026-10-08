CREATE UNIQUE INDEX "Expense_tenantId_companyId_id_key" ON "Expense"("tenantId","companyId",id);
CREATE TABLE "ExpenseVat" (
 "entryId" UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"expenseId" UUID NOT NULL UNIQUE,
 "netAmount" NUMERIC(18,3) NOT NULL CHECK("netAmount">0),"taxAmount" NUMERIC(18,3) NOT NULL CHECK("taxAmount">=0),"recoverableTax" NUMERIC(18,3) NOT NULL CHECK("recoverableTax">=0 AND "recoverableTax"<="taxAmount"),
 "treatment" VARCHAR(12) NOT NULL CHECK(treatment IN('STANDARD','ZERO','EXEMPT','NO_VAT')),"recoverable" BOOLEAN NOT NULL CHECK(NOT recoverable OR treatment='STANDARD'),
 "inputAccountId" UUID,"supplierName" VARCHAR(200) NOT NULL CHECK(length(trim("supplierName")) BETWEEN 2 AND 200),"supplierTaxNumber" VARCHAR(40) CHECK(length(trim("supplierTaxNumber")) BETWEEN 3 AND 40),"reference" VARCHAR(120) NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 120),
 CHECK(treatment<>'STANDARD' OR "supplierTaxNumber" IS NOT NULL),
 FOREIGN KEY("tenantId","companyId","entryId") REFERENCES "JournalEntry"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","expenseId") REFERENCES "Expense"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","inputAccountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE INDEX "ExpenseVat_tenantId_companyId_idx" ON "ExpenseVat"("tenantId","companyId");
CREATE FUNCTION erp_validate_expense_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e "Expense"%ROWTYPE; j "JournalEntry"%ROWTYPE; p "CompanyVatProfile"%ROWTYPE; expected_tax NUMERIC; cost_account UUID; payment_account UUID;
BEGIN
 SELECT * INTO e FROM "Expense" WHERE id=NEW."expenseId" FOR UPDATE;
 SELECT * INTO j FROM "JournalEntry" WHERE id=NEW."entryId";
 SELECT * INTO p FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 IF e.id IS NULL OR j.id IS NULL OR e."tenantId"<>NEW."tenantId" OR e."companyId"<>NEW."companyId" OR e.status<>'POSTED' OR e.currency<>'OMR' OR j.currency<>e.currency OR j."tenantId"<>e."tenantId" OR j."companyId"<>e."companyId" OR j."branchId" IS DISTINCT FROM e."branchId" OR j."reversalOf" IS NOT NULL OR j."entryDate"<e."expenseDate" OR j."creationTransaction"<>txid_current()::text OR j.number<>erp_purchase_document_number('SYSE',e.id) OR NEW."netAmount"<>e.amount THEN RAISE EXCEPTION 'Invalid or late expense VAT snapshot' USING ERRCODE='23514';END IF;
 IF p.enabled IS DISTINCT FROM true OR p."effectiveFrom" IS NULL OR e."expenseDate"<p."effectiveFrom" OR (NEW."recoverableTax">0 AND NEW."inputAccountId" IS DISTINCT FROM p."inputAccountId") THEN RAISE EXCEPTION 'Expense VAT requires effective registered profile' USING ERRCODE='23514';END IF;
 expected_tax:=CASE WHEN NEW.treatment='STANDARD' THEN round(e.amount*0.05,3) ELSE 0 END;
 IF NEW."taxAmount"<>expected_tax OR NEW."recoverableTax"<>(CASE WHEN NEW.recoverable THEN expected_tax ELSE 0 END) OR j.total<>e.amount+expected_tax THEN RAISE EXCEPTION 'Expense VAT totals mismatch' USING ERRCODE='23514';END IF;
 SELECT "accountId" INTO cost_account FROM "JournalLine" WHERE "entryId"=j.id AND position=0;
 SELECT "accountId" INTO payment_account FROM "JournalLine" WHERE "entryId"=j.id AND position=1;
 IF cost_account IS NULL OR payment_account IS NULL OR cost_account=payment_account OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=cost_account AND type='EXPENSE') OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=payment_account AND type IN('ASSET','LIABILITY')) OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=j.id)<>(CASE WHEN NEW."recoverableTax">0 THEN 3 ELSE 2 END) THEN RAISE EXCEPTION 'Expense VAT account shape mismatch' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND position=0 AND debit=j.total-NEW."recoverableTax" AND credit=0) OR NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND position=1 AND debit=0 AND credit=j.total) THEN RAISE EXCEPTION 'Expense VAT journal mismatch' USING ERRCODE='23514';END IF;
 IF NEW."recoverableTax">0 AND (NEW."inputAccountId" IS NULL OR NEW."inputAccountId" IN(cost_account,payment_account) OR NOT EXISTS(SELECT 1 FROM "LedgerAccount" WHERE id=NEW."inputAccountId" AND type='ASSET') OR NOT EXISTS(SELECT 1 FROM "JournalLine" WHERE "entryId"=j.id AND position=2 AND "accountId"=NEW."inputAccountId" AND debit=NEW."recoverableTax" AND credit=0)) THEN RAISE EXCEPTION 'Expense input VAT journal mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_vat_validate BEFORE INSERT ON "ExpenseVat" FOR EACH ROW EXECUTE FUNCTION erp_validate_expense_vat();
CREATE TRIGGER expense_vat_immutable BEFORE UPDATE OR DELETE ON "ExpenseVat" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_require_expense_vat() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_id UUID; e "Expense"%ROWTYPE; p "CompanyVatProfile"%ROWTYPE;
BEGIN
 IF NEW.number !~ '^SYSE-' THEN RETURN NULL;END IF;
 SELECT a."entityId"::uuid INTO source_id FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a.entity='Expense' AND a.action='expense.ledger_posted' AND a.metadata->>'journalId'=NEW.id::text AND NEW.number=erp_purchase_document_number('SYSE',a."entityId"::uuid);
 IF source_id IS NULL THEN RAISE EXCEPTION 'Expense journal requires matching source audit' USING ERRCODE='23514';END IF;
 SELECT * INTO e FROM "Expense" WHERE id=source_id;
 SELECT * INTO p FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 IF e."tenantId" IS DISTINCT FROM NEW."tenantId" OR e."companyId" IS DISTINCT FROM NEW."companyId" OR e."branchId" IS DISTINCT FROM NEW."branchId" OR e.status<>'POSTED' OR NEW.currency<>e.currency OR NEW."entryDate"<e."expenseDate" THEN RAISE EXCEPTION 'Expense journal source mismatch' USING ERRCODE='23514';END IF;
 IF p.enabled AND e."expenseDate">=p."effectiveFrom" AND NOT EXISTS(SELECT 1 FROM "ExpenseVat" WHERE "entryId"=NEW.id AND "expenseId"=e.id) THEN RAISE EXCEPTION 'Registered expense requires VAT classification' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "ExpenseVat" WHERE "entryId"=NEW.id) AND NEW.total<>e.amount THEN RAISE EXCEPTION 'Expense source amount mismatch' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER expense_vat_required AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_require_expense_vat();
CREATE FUNCTION erp_preserve_expense_vat_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM "ExpenseVat" WHERE "expenseId"=OLD.id) AND ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW.number,NEW.amount,NEW.currency,NEW."expenseDate",NEW.description,NEW.category) IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD.number,OLD.amount,OLD.currency,OLD."expenseDate",OLD.description,OLD.category) THEN RAISE EXCEPTION 'Expense VAT source financial fields are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_vat_source_immutable BEFORE UPDATE ON "Expense" FOR EACH ROW EXECUTE FUNCTION erp_preserve_expense_vat_source();
ALTER TABLE "ExpenseVat" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ExpenseVat" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ExpenseVat" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_validate_expense_vat(),erp_require_expense_vat(),erp_preserve_expense_vat_source() FROM PUBLIC;
