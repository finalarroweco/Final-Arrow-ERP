BEGIN;
-- Forward-only request fence. Removing this table/guard after use revives delayed imports.
-- No statement rows, history, amounts or certificates are rewritten or backfilled.
CREATE TABLE "BankStatementImportCancellation" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL CHECK("requestHash" ~ '^[0-9a-f]{64}$'),"createdBy" UUID NOT NULL,
 "cancelledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "auditId" UUID NOT NULL DEFAULT gen_random_uuid(),"transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
 FOREIGN KEY("tenantId","companyId","accountId") REFERENCES "LedgerAccount"("tenantId","companyId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("auditId") REFERENCES "AuditLog"(id) ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX "BankStatementImportCancellation_auditId_key" ON "BankStatementImportCancellation"("auditId");
CREATE INDEX "BankStatementImportCancellation_scope_time_idx" ON "BankStatementImportCancellation"("tenantId","companyId","accountId","cancelledAt");

-- Invoker functions, trusted backend model: the actor argument does not authenticate SQL callers.
-- Account-first is intentional compatibility with already dispatched older import transactions.
-- Never lock another account or an existing statement after the UUID advisory lock.
CREATE FUNCTION erp_lock_bank_statement_import(tid UUID,cid UUID,aid UUID,rid UUID,actor UUID) RETURNS VOID LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Bank imports require read committed isolation' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Tenant" WHERE id=tid FOR SHARE;
 PERFORM 1 FROM "LedgerAccount" WHERE id=aid AND "tenantId"=tid AND "companyId"=cid AND type='ASSET' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bank import requires scoped asset account' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-statement-import:'||rid::text,0));
 -- Fresh post-wait authorization. Tenant SHARE serializes role management.
 PERFORM erp_require_bank_certificate_actor(tid,cid,actor,'ledger:post');
END $$;
CREATE FUNCTION erp_guard_bank_statement_import_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM erp_lock_bank_statement_import(NEW."tenantId",NEW."companyId",NEW."accountId",NEW.id,NEW."createdBy");
 IF EXISTS(SELECT 1 FROM "BankStatementImportCancellation" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Bank import request permanently abandoned' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Alphabetically precedes existing bank_statement_validate without replacing it.
CREATE TRIGGER bank_statement_import_fence BEFORE INSERT ON "BankStatement" FOR EACH ROW EXECUTE FUNCTION erp_guard_bank_statement_import_fence();
CREATE FUNCTION erp_guard_bank_statement_import_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Bank import cancellations are permanent' USING ERRCODE='23514'; END IF;
 PERFORM erp_lock_bank_statement_import(NEW."tenantId",NEW."companyId",NEW."accountId",NEW.id,NEW."createdBy");
 IF EXISTS(SELECT 1 FROM "BankStatement" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Bank import request already committed' USING ERRCODE='23514'; END IF;
 NEW."cancelledAt":=clock_timestamp();NEW."auditId":=gen_random_uuid();NEW."transactionId":=txid_current()::text;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_statement_import_cancellation_guard BEFORE INSERT OR UPDATE OR DELETE ON "BankStatementImportCancellation" FOR EACH ROW EXECUTE FUNCTION erp_guard_bank_statement_import_cancellation();
CREATE FUNCTION erp_audit_bank_statement_import_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 -- Generic audit views must not expose private request UUID, account or request digest.
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(NEW."auditId",NEW."tenantId",NEW."createdBy",'bank-statement-import.abandoned','BankStatementImportCancellation',NEW."auditId"::text,jsonb_build_object('outcome','ABANDONED'),NEW."cancelledAt" AT TIME ZONE 'UTC');
 RETURN NEW;
END $$;
CREATE TRIGGER bank_statement_import_cancellation_audit AFTER INSERT ON "BankStatementImportCancellation" FOR EACH ROW EXECUTE FUNCTION erp_audit_bank_statement_import_cancellation();
CREATE FUNCTION erp_guard_bank_statement_import_cancellation_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND (OLD.entity='BankStatementImportCancellation' OR OLD.action='bank-statement-import.abandoned' OR EXISTS(SELECT 1 FROM "BankStatementImportCancellation" WHERE "auditId"=OLD.id)) THEN RAISE EXCEPTION 'Bank import cancellation audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity='BankStatementImportCancellation' OR NEW.action='bank-statement-import.abandoned' OR EXISTS(SELECT 1 FROM "BankStatementImportCancellation" WHERE "auditId"=NEW.id) THEN
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM "BankStatementImportCancellation" c WHERE c."auditId"=NEW.id AND c."tenantId"=NEW."tenantId" AND c."createdBy"=NEW."actorId" AND NEW.entity='BankStatementImportCancellation' AND NEW.action='bank-statement-import.abandoned' AND NEW."entityId"=c."auditId"::text AND NEW.metadata=jsonb_build_object('outcome','ABANDONED') AND NEW."createdAt"=c."cancelledAt" AT TIME ZONE 'UTC' AND c."transactionId"=txid_current()::text AND c.xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'Bank import cancellation audit must be exact and source-generated' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_statement_import_cancellation_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_bank_statement_import_cancellation_audit();
CREATE FUNCTION erp_guard_bank_statement_import_cancellation_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Bank import cancellations cannot be truncated' USING ERRCODE='23514'; END $$;
CREATE TRIGGER bank_statement_import_cancellation_truncate BEFORE TRUNCATE ON "BankStatementImportCancellation" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_bank_statement_import_cancellation_truncate();
-- AuditLog already has a shared BEFORE TRUNCATE guard (migration 77).
ALTER TABLE "BankStatementImportCancellation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BankStatementImportCancellation" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_lock_bank_statement_import(UUID,UUID,UUID,UUID,UUID),erp_guard_bank_statement_import_fence(),erp_guard_bank_statement_import_cancellation(),erp_audit_bank_statement_import_cancellation(),erp_guard_bank_statement_import_cancellation_audit(),erp_guard_bank_statement_import_cancellation_truncate() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "BankStatementImportCancellation" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_lock_bank_statement_import(UUID,UUID,UUID,UUID,UUID),erp_guard_bank_statement_import_fence(),erp_guard_bank_statement_import_cancellation(),erp_audit_bank_statement_import_cancellation(),erp_guard_bank_statement_import_cancellation_audit(),erp_guard_bank_statement_import_cancellation_truncate() FROM %I',r);
END IF; END LOOP; END $$;
COMMIT;
