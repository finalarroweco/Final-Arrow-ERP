-- Explicit manual allocations. Existing full matches retain their identity and history.
-- The backfill and guard replacement are one transaction; no unguarded write window.
BEGIN;
LOCK TABLE "BankMatch" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "BankMatch" ADD COLUMN amount DECIMAL(18,3), ADD COLUMN kind VARCHAR(8) NOT NULL DEFAULT 'match';
ALTER TABLE "BankMatch" DISABLE TRIGGER bank_match_validate;
UPDATE "BankMatch" m SET amount=abs(l.amount) FROM "BankStatementLine" l WHERE l.id=m."bankLineId";
ALTER TABLE "BankMatch" ENABLE TRIGGER bank_match_validate;
ALTER TABLE "BankMatch" ALTER COLUMN amount SET NOT NULL;
ALTER TABLE "BankMatch" ADD CONSTRAINT bank_allocation_positive CHECK(amount>0), ADD CONSTRAINT bank_allocation_kind CHECK(kind IN('match','allocate'));
DROP INDEX bank_match_active_bank;
DROP INDEX bank_match_active_journal;
CREATE INDEX bank_match_active_bank ON "BankMatch"("bankLineId") INCLUDE(amount) WHERE "cancelledAt" IS NULL;
CREATE INDEX bank_match_active_journal ON "BankMatch"("journalLineId") INCLUDE(amount) WHERE "cancelledAt" IS NULL;
CREATE INDEX bank_match_bank_history ON "BankMatch"("bankLineId","createdAt",id);
CREATE INDEX bank_match_journal_history ON "BankMatch"("journalLineId","createdAt",id);

CREATE OR REPLACE FUNCTION erp_validate_bank_match() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b RECORD; j RECORD; bank_used NUMERIC; book_used NUMERIC; actor UUID;
BEGIN
 -- Fresh snapshots after the serialization lock are required for current capacity
 -- and permission checks, including SQL callers outside the application.
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Bank allocations require read committed isolation' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD."cancelledAt" IS NOT NULL OR NEW."cancelledAt" IS NULL OR (to_jsonb(NEW)-ARRAY['cancelledAt','cancelledBy','cancelReason'])<>(to_jsonb(OLD)-ARRAY['cancelledAt','cancelledBy','cancelReason']) THEN RAISE EXCEPTION 'Bank allocations only permit one audited cancellation' USING ERRCODE='23514'; END IF;
  actor:=NEW."cancelledBy";
 ELSE actor:=NEW."createdBy";
 END IF;
 -- The shared tenant lock is acquired before the account lock. Role mutations
 -- obtain the exclusive tenant lock, so authorization cannot change mid-write.
 PERFORM erp_require_bank_certificate_actor(NEW."tenantId",NEW."companyId",actor,'ledger:post');
 IF TG_OP='INSERT' THEN PERFORM pg_advisory_xact_lock(hashtextextended('bank-request:'||NEW.id::text,0)); END IF;
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='ASSET' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bank allocation requires scoped asset account' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN NEW."cancelledAt":=clock_timestamp();RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM "BankRequestResolution" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Bank request permanently abandoned' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp();
 SELECT l.amount,s.currency,s."to" INTO b FROM "BankStatementLine" l JOIN "BankStatement" s ON s.id=l."statementId" WHERE l.id=NEW."bankLineId" AND l."tenantId"=NEW."tenantId" AND l."companyId"=NEW."companyId" AND l."accountId"=NEW."accountId" AND s."voidedAt" IS NULL;
 SELECT l.debit-l.credit amount,e.currency,e."entryDate" INTO j FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" WHERE l.id=NEW."journalLineId" AND l."tenantId"=NEW."tenantId" AND l."companyId"=NEW."companyId" AND l."accountId"=NEW."accountId";
 IF NEW."cancelledAt" IS NOT NULL OR NEW."cancelledBy" IS NOT NULL OR NEW."cancelReason" IS NOT NULL OR b.amount IS NULL OR j.amount IS NULL OR NEW.amount IS NULL OR NEW.amount<=0 OR sign(b.amount)<>sign(j.amount) OR b.currency<>j.currency OR j."entryDate">b."to" THEN RAISE EXCEPTION 'Bank allocation source, amount, direction, currency or date mismatch' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO bank_used FROM "BankMatch" WHERE "bankLineId"=NEW."bankLineId" AND "cancelledAt" IS NULL;
 SELECT coalesce(sum(amount),0) INTO book_used FROM "BankMatch" WHERE "journalLineId"=NEW."journalLineId" AND "cancelledAt" IS NULL;
 IF bank_used+NEW.amount>abs(b.amount) OR book_used+NEW.amount>abs(j.amount) THEN RAISE EXCEPTION 'Bank allocation exceeds remaining source capacity' USING ERRCODE='23514'; END IF;
 -- Legacy full-match requests keep their original exact-pair eligibility.
 IF NEW.kind='match' AND (b.amount<>j.amount OR NEW.amount<>abs(b.amount) OR bank_used<>0 OR book_used<>0) THEN RAISE EXCEPTION 'Full bank match requires unused equal sources' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION erp_bank_allocation_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor UUID; action_name TEXT; sid UUID;
BEGIN
 actor:=CASE WHEN TG_OP='INSERT' THEN NEW."createdBy" ELSE NEW."cancelledBy" END;
 action_name:=CASE WHEN TG_OP='INSERT' THEN 'bank-match.created' ELSE 'bank-match.cancelled' END;
 SELECT "statementId" INTO sid FROM "BankStatementLine" WHERE id=NEW."bankLineId";
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=actor AND a.entity='BankMatch' AND a."entityId"=NEW.id::text AND a.action=action_name AND a.metadata->>'transaction'=txid_current()::text AND a.xmin::text=(txid_current()%4294967296)::text AND a.metadata->>'statementId'=sid::text AND a.metadata->>'bankLineId'=NEW."bankLineId"::text AND a.metadata->>'journalLineId'=NEW."journalLineId"::text AND a.metadata->>'amount'=NEW.amount::text AND a.metadata->>'kind'=NEW.kind AND (TG_OP='INSERT' OR a.metadata->>'reason'=NEW."cancelReason")) THEN RAISE EXCEPTION 'Bank allocation change requires same-transaction source audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bank_allocation_audit AFTER INSERT OR UPDATE ON "BankMatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_bank_allocation_audit();

CREATE OR REPLACE FUNCTION erp_bank_statement_correction() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bank statement history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Bank corrections require read committed isolation' USING ERRCODE='23514'; END IF;
 IF OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['voidedAt','voidedBy','voidReason'])<>(to_jsonb(OLD)-ARRAY['voidedAt','voidedBy','voidReason']) THEN RAISE EXCEPTION 'Only a one-time bank statement void is allowed' USING ERRCODE='23514'; END IF;
 PERFORM erp_require_bank_certificate_actor(OLD."tenantId",OLD."companyId",NEW."voidedBy",'ledger:post');
 PERFORM 1 FROM "LedgerAccount" WHERE id=OLD."accountId" AND "tenantId"=OLD."tenantId" AND "companyId"=OLD."companyId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE l."statementId"=OLD.id AND m."cancelledAt" IS NULL) THEN RAISE EXCEPTION 'Cancel active allocations before voiding a statement' USING ERRCODE='23514'; END IF;
 NEW."voidedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION erp_bank_statement_void_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."voidedBy" AND a.entity='BankStatement' AND a."entityId"=NEW.id::text AND a.action='bank-statement.voided' AND a.metadata->>'transaction'=txid_current()::text AND a.xmin::text=(txid_current()%4294967296)::text AND a.metadata->>'accountId'=NEW."accountId"::text AND a.metadata->>'reason'=NEW."voidReason") THEN RAISE EXCEPTION 'Bank statement void requires same-transaction source audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bank_statement_void_audit AFTER UPDATE ON "BankStatement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_bank_statement_void_audit();
REVOKE ALL ON FUNCTION erp_bank_allocation_audit(),erp_validate_bank_match(),erp_bank_statement_correction(),erp_bank_statement_void_audit() FROM PUBLIC;

-- Forward-only v2 capture. Stored v1 records and canonical hash functions are untouched.
-- A certificate records an internal observation, never a posting lock or approval.
CREATE OR REPLACE FUNCTION erp_bank_reconciliation_inputs(sid UUID, tid UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE srow RECORD; total INTEGER; result JSONB;
BEGIN
 SELECT * INTO srow FROM "BankStatement" WHERE id=sid AND "tenantId"=tid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- Reject oversized sources/history before any nested JSON aggregation.
 SELECT count(*) INTO total FROM (SELECT l.id FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" WHERE l."tenantId"=tid AND l."companyId"=srow."companyId" AND l."accountId"=srow."accountId" AND e."entryDate"<=srow."to" LIMIT 20001) q;
 IF total>20000 THEN RAISE EXCEPTION 'Snapshot source limit exceeded' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO total FROM (SELECT l.id FROM "BankStatementLine" l JOIN "BankStatement" b ON b.id=l."statementId" WHERE l."tenantId"=tid AND l."companyId"=srow."companyId" AND l."accountId"=srow."accountId" AND l."bookingDate"<=srow."to" AND (b."voidedAt" IS NULL OR b.id=sid) LIMIT 20001) q;
 IF total>20000 THEN RAISE EXCEPTION 'Snapshot source limit exceeded' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO total FROM (SELECT m.id FROM "BankMatch" m JOIN "BankStatementLine" b ON b.id=m."bankLineId" JOIN "BankStatement" s ON s.id=b."statementId" JOIN "JournalLine" l ON l.id=m."journalLineId" JOIN "JournalEntry" e ON e.id=l."entryId" WHERE m."tenantId"=tid AND m."companyId"=srow."companyId" AND m."accountId"=srow."accountId" AND (e."entryDate"<=srow."to" OR (b."bookingDate"<=srow."to" AND (s."voidedAt" IS NULL OR s.id=sid))) LIMIT 20001) q;
 IF total>20000 THEN RAISE EXCEPTION 'Snapshot allocation history limit exceeded' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO total FROM (SELECT l.id FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" WHERE l."tenantId"=tid AND l."companyId"=srow."companyId" AND l."accountId"=srow."accountId" AND e."entryDate"<=srow."to" AND abs(l.debit-l.credit)>coalesce((SELECT sum(m.amount) FROM "BankMatch" m JOIN "BankStatementLine" b ON b.id=m."bankLineId" WHERE m."journalLineId"=l.id AND m."cancelledAt" IS NULL AND b."bookingDate"<=srow."to"),0) LIMIT 5001) q;
 IF total>5000 THEN RAISE EXCEPTION 'Snapshot outstanding limit exceeded' USING ERRCODE='23514'; END IF;
 WITH s AS MATERIALIZED (SELECT s.*,c.name company_name,a.code account_code,a.name account_name FROM "BankStatement" s JOIN "Company" c ON c.id=s."companyId" JOIN "LedgerAccount" a ON a.id=s."accountId" WHERE s.id=sid AND s."tenantId"=tid),
 book AS (SELECT l.*,e.number,e."entryDate",e.description,e.currency FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" JOIN s ON s."tenantId"=l."tenantId" AND s."companyId"=l."companyId" AND s."accountId"=l."accountId" WHERE e."entryDate"<=s."to" ORDER BY e."entryDate",l.id LIMIT 20001),
 bank AS (SELECT l.*,b.reference statement_reference,b."from" statement_from,b."to" statement_to,b.currency statement_currency,b."voidedAt" statement_voided,b."voidReason" statement_void_reason FROM "BankStatementLine" l JOIN "BankStatement" b ON b.id=l."statementId" JOIN s ON s."tenantId"=l."tenantId" AND s."companyId"=l."companyId" AND s."accountId"=l."accountId" WHERE l."bookingDate"<=s."to" AND (b."voidedAt" IS NULL OR b.id=s.id) ORDER BY l."bookingDate",l."statementId",l.position,l.id LIMIT 20001)
 SELECT jsonb_build_object('version',2,'tenantId',s."tenantId",'companyId',s."companyId",'accountId',s."accountId",'statementId',s.id,
 'company',jsonb_build_object('id',s."companyId",'name',s.company_name),'account',jsonb_build_object('id',s."accountId",'code',s.account_code,'name',s.account_name),
 'statement',jsonb_build_object('id',s.id,'reference',s.reference,'from',s."from",'to',s."to",'currency',s.currency,'opening',s.opening::text,'closing',s.closing::text,'voidedAt',to_char(s."voidedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'voidReason',s."voidReason",'createdAt',to_char(s."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',s."createdBy"),
 'book',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'entryId',b."entryId",'entryNumber',b.number,'entryDate',b."entryDate",'description',b.description,'currency',b.currency,'debit',b.debit::text,'credit',b.credit::text,'amount',(b.debit-b.credit)::text,
 'allocated',(coalesce((SELECT sum(m.amount) FROM "BankMatch" m WHERE m."journalLineId"=b.id AND m."cancelledAt" IS NULL),0))::numeric(18,3)::text,'currentRemaining',(abs(b.debit-b.credit)-coalesce((SELECT sum(m.amount) FROM "BankMatch" m WHERE m."journalLineId"=b.id AND m."cancelledAt" IS NULL),0))::numeric(18,3)::text,'cutoffRemaining',(abs(b.debit-b.credit)-coalesce((SELECT sum(m.amount) FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE m."journalLineId"=b.id AND m."cancelledAt" IS NULL AND l."bookingDate"<=s."to"),0))::numeric(18,3)::text,
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'amount',m.amount::text,'kind',m.kind,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',m."createdBy",'cancelledAt',to_char(m."cancelledAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cancelledBy',m."cancelledBy",'cancelReason',m."cancelReason",'bankLineId',l.id,'statementId',l."statementId",'bookingDate',l."bookingDate",'sourceAmount',l.amount::text) ORDER BY m."createdAt",m.id) FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE m."journalLineId"=b.id),'[]'::jsonb)) ORDER BY b."entryDate",b.id) FROM book b),'[]'::jsonb),
 'bank',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'statementId',b."statementId",'statementReference',b.statement_reference,'statementFrom',b.statement_from,'statementTo',b.statement_to,'statementCurrency',b.statement_currency,'statementVoidedAt',to_char(b.statement_voided,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'statementVoidReason',b.statement_void_reason,'position',b.position,'bookingDate',b."bookingDate",'reference',b.reference,'amount',b.amount::text,
 'allocated',(coalesce((SELECT sum(m.amount) FROM "BankMatch" m WHERE m."bankLineId"=b.id AND m."cancelledAt" IS NULL),0))::numeric(18,3)::text,'currentRemaining',(abs(b.amount)-coalesce((SELECT sum(m.amount) FROM "BankMatch" m WHERE m."bankLineId"=b.id AND m."cancelledAt" IS NULL),0))::numeric(18,3)::text,'cutoffRemaining',(abs(b.amount)-coalesce((SELECT sum(m.amount) FROM "BankMatch" m WHERE m."bankLineId"=b.id AND m."cancelledAt" IS NULL),0))::numeric(18,3)::text,
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'amount',m.amount::text,'kind',m.kind,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',m."createdBy",'cancelledAt',to_char(m."cancelledAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'cancelledBy',m."cancelledBy",'cancelReason',m."cancelReason",'journalLineId',l.id,'entryId',e.id,'entryNumber',e.number,'entryDate',e."entryDate",'currency',e.currency,'sourceAmount',(l.debit-l.credit)::text) ORDER BY m."createdAt",m.id) FROM "BankMatch" m JOIN "JournalLine" l ON l.id=m."journalLineId" JOIN "JournalEntry" e ON e.id=l."entryId" WHERE m."bankLineId"=b.id),'[]'::jsonb)) ORDER BY b."bookingDate",b."statementId",b.position,b.id) FROM bank b),'[]'::jsonb)) INTO result FROM s;
 IF octet_length(convert_to(erp_bank_certificate_canonical(result),'UTF8'))>16777216 THEN RAISE EXCEPTION 'Snapshot exceeds 16 MiB' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION erp_bank_certificate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE inputs JSONB; expected JSONB; book_total NUMERIC; outstanding NUMERIC; pending INTEGER; outstanding_count INTEGER; adjusted NUMERIC; canonical_snapshot TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Bank snapshots require read committed isolation' USING ERRCODE='23514'; END IF;
 PERFORM erp_require_bank_certificate_actor(NEW."tenantId",NEW."companyId",NEW."createdBy",'bank-reconciliation:create');
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 inputs:=erp_bank_reconciliation_inputs(NEW."statementId",NEW."tenantId");
 IF inputs IS NULL OR NEW.snapshot-'summary' IS DISTINCT FROM inputs OR inputs->>'companyId'<>NEW."companyId"::text OR inputs->>'accountId'<>NEW."accountId"::text THEN RAISE EXCEPTION 'Snapshot sources changed or scope mismatch' USING ERRCODE='23514'; END IF;
 canonical_snapshot:=erp_bank_certificate_canonical(NEW.snapshot);
 IF jsonb_array_length(inputs->'book')>20000 OR jsonb_array_length(inputs->'bank')>20000 OR octet_length(convert_to(canonical_snapshot,'UTF8'))>16777216 THEN RAISE EXCEPTION 'Snapshot exceeds bounded inputs' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(inputs->'book') b WHERE b->>'currency'<>inputs#>>'{statement,currency}') OR EXISTS(SELECT 1 FROM jsonb_array_elements(inputs->'bank') b WHERE b->>'statementCurrency'<>inputs#>>'{statement,currency}') THEN RAISE EXCEPTION 'Snapshot cannot combine currencies' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum((b->>'amount')::numeric),0),coalesce(sum(sign((b->>'amount')::numeric)*(b->>'cutoffRemaining')::numeric),0),count(*) FILTER(WHERE (b->>'cutoffRemaining')::numeric<>0) INTO book_total,outstanding,outstanding_count FROM jsonb_array_elements(inputs->'book') b;
 IF outstanding_count>5000 THEN RAISE EXCEPTION 'Snapshot exceeds outstanding input limit' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO pending FROM jsonb_array_elements(inputs->'bank') b WHERE b->>'statementVoidedAt' IS NULL AND (b->>'currentRemaining')::numeric<>0;
 adjusted:=(inputs#>>'{statement,closing}')::numeric+outstanding;
 expected:=jsonb_build_object('bookClosing',book_total::numeric(24,3)::text,'outstandingTotal',outstanding::numeric(24,3)::text,'adjustedBank',adjusted::numeric(24,3)::text,'difference',(book_total-adjusted)::numeric(24,3)::text,'pendingBank',pending,'reconciled',inputs#>>'{statement,voidedAt}' IS NULL AND pending=0 AND book_total=adjusted,'bookLines',jsonb_array_length(inputs->'book'),'bankLines',jsonb_array_length(inputs->'bank'),'outstandingLines',outstanding_count);
 IF NEW.digest IS DISTINCT FROM encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex') THEN RAISE EXCEPTION 'Snapshot content digest mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.summary IS DISTINCT FROM expected OR NEW.snapshot->'summary' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Snapshot summary does not reconcile' USING ERRCODE='23514'; END IF;
 IF NEW."observedAt"<transaction_timestamp()-interval '1 millisecond' OR NEW."observedAt">clock_timestamp()+interval '1 second' THEN RAISE EXCEPTION 'Invalid snapshot observation time' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;

CREATE TABLE "BankRequestResolution" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,"statementId" UUID NOT NULL,"actorId" UUID NOT NULL,
 "requestDigest" VARCHAR(64) NOT NULL CHECK("requestDigest" ~ '^[a-f0-9]{64}$'),request JSONB NOT NULL,
 outcome VARCHAR(9) NOT NULL DEFAULT 'ABANDONED' CHECK(outcome IN('ABANDONED','COMMITTED')),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId","accountId","statementId") REFERENCES "BankStatement"("tenantId","companyId","accountId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "BankRequestResolution_tenantId_statementId_createdAt_idx" ON "BankRequestResolution"("tenantId","statementId","createdAt");
CREATE FUNCTION erp_bank_request_resolution_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE action_name TEXT; keys TEXT[]; key_name TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Bank request resolution requires read committed isolation' USING ERRCODE='23514'; END IF;
 PERFORM erp_require_bank_certificate_actor(NEW."tenantId",NEW."companyId",NEW."actorId",'ledger:post');
 PERFORM pg_advisory_xact_lock(hashtextextended('bank-request:'||NEW.id::text,0));
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND type='ASSET' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM "BankStatement" WHERE id=NEW."statementId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "accountId"=NEW."accountId") THEN RAISE EXCEPTION 'Bank resolution statement scope mismatch' USING ERRCODE='23514'; END IF;
 IF (NEW.outcome='ABANDONED' OR NEW.request->>'action' IN ('cancel','void')) AND EXISTS(SELECT 1 FROM "BankMatch" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Request ID already belongs to an allocation' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.request) IS DISTINCT FROM 'object' OR octet_length(NEW.request::text)>4096 OR NEW.request->>'requestId' IS DISTINCT FROM NEW.id::text OR NEW.request->>'tenantId' IS DISTINCT FROM NEW."tenantId"::text THEN RAISE EXCEPTION 'Bank resolution request identity mismatch' USING ERRCODE='23514'; END IF;
 action_name:=NEW.request->>'action';
 CASE action_name
 WHEN 'match' THEN keys:=ARRAY['tenantId','requestId','action','bankLineId','journalLineId'];
 WHEN 'allocate' THEN keys:=ARRAY['tenantId','requestId','action','bankLineId','journalLineId','amount'];
 WHEN 'cancel' THEN keys:=ARRAY['tenantId','requestId','action','matchId','reason'];
 WHEN 'void' THEN keys:=ARRAY['tenantId','requestId','action','reason'];
 ELSE RAISE EXCEPTION 'Invalid abandoned bank action' USING ERRCODE='23514';
 END CASE;
 IF NEW.request-keys<>'{}'::jsonb OR NOT (NEW.request ?& keys) THEN RAISE EXCEPTION 'Invalid abandoned bank request fields' USING ERRCODE='23514'; END IF;
 FOREACH key_name IN ARRAY keys LOOP
  IF jsonb_typeof(NEW.request->key_name) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Bank request values must be strings' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF action_name IN ('match','allocate') AND ((NEW.request->>'bankLineId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (NEW.request->>'journalLineId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'Bank request source identity invalid' USING ERRCODE='23514'; END IF;
 IF action_name='allocate' THEN
  IF (NEW.request->>'amount') !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR (NEW.request->>'amount')::numeric<=0 THEN RAISE EXCEPTION 'Bank request amount must be normalized positive magnitude' USING ERRCODE='23514'; END IF;
 END IF;
 IF action_name='cancel' AND (NEW.request->>'matchId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Bank cancellation identity invalid' USING ERRCODE='23514'; END IF;
 IF action_name IN ('cancel','void') AND (length(NEW.request->>'reason') NOT BETWEEN 3 AND 300 OR btrim(NEW.request->>'reason')<>NEW.request->>'reason') THEN RAISE EXCEPTION 'Bank correction reason invalid' USING ERRCODE='23514'; END IF;
 IF NEW."requestDigest" IS DISTINCT FROM erp_bank_certificate_digest(jsonb_build_object('actorId',NEW."actorId",'statementId',NEW."statementId",'request',NEW.request)) THEN RAISE EXCEPTION 'Bank resolution request digest mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.outcome='COMMITTED' THEN
  IF action_name IN ('match','allocate') THEN
   IF NOT EXISTS(SELECT 1 FROM "BankMatch" m JOIN "BankStatementLine" b ON b.id=m."bankLineId" WHERE m.id=NEW.id AND m."tenantId"=NEW."tenantId" AND m."companyId"=NEW."companyId" AND m."accountId"=NEW."accountId" AND b."statementId"=NEW."statementId" AND m."createdBy"=NEW."actorId" AND m.kind=action_name AND m."bankLineId"::text=NEW.request->>'bankLineId' AND m."journalLineId"::text=NEW.request->>'journalLineId' AND (action_name='match' OR m.amount=(NEW.request->>'amount')::numeric)) THEN RAISE EXCEPTION 'Committed allocation receipt does not match saved effect' USING ERRCODE='23514'; END IF;
  ELSIF action_name='cancel' THEN
   IF NOT EXISTS(SELECT 1 FROM "BankMatch" m JOIN "BankStatementLine" b ON b.id=m."bankLineId" WHERE m.id::text=NEW.request->>'matchId' AND m."tenantId"=NEW."tenantId" AND m."companyId"=NEW."companyId" AND m."accountId"=NEW."accountId" AND b."statementId"=NEW."statementId" AND m."cancelledAt" IS NOT NULL AND m."cancelledBy"=NEW."actorId" AND m."cancelReason"=NEW.request->>'reason') THEN RAISE EXCEPTION 'Committed cancellation receipt does not match saved effect' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM "BankStatement" b WHERE b.id=NEW."statementId" AND b."tenantId"=NEW."tenantId" AND b."companyId"=NEW."companyId" AND b."accountId"=NEW."accountId" AND b."voidedAt" IS NOT NULL AND b."voidedBy"=NEW."actorId" AND b."voidReason"=NEW.request->>'reason') THEN RAISE EXCEPTION 'Committed void receipt does not match saved effect' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE FUNCTION erp_bank_request_resolution_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."actorId" AND a.entity='BankRequestResolution' AND a."entityId"=NEW.id::text AND a.action=CASE WHEN NEW.outcome='ABANDONED' THEN 'bank-request.abandoned' ELSE 'bank-request.committed' END AND a.metadata->>'transaction'=txid_current()::text AND a.xmin::text=(txid_current()%4294967296)::text AND a.metadata->>'statementId'=NEW."statementId"::text AND a.metadata->>'requestDigest'=NEW."requestDigest") THEN RAISE EXCEPTION 'Bank request abandonment requires same-transaction audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER bank_request_resolution_guard BEFORE INSERT ON "BankRequestResolution" FOR EACH ROW EXECUTE FUNCTION erp_bank_request_resolution_guard();
CREATE TRIGGER bank_request_resolution_immutable BEFORE UPDATE OR DELETE ON "BankRequestResolution" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE CONSTRAINT TRIGGER bank_request_resolution_audit AFTER INSERT ON "BankRequestResolution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_bank_request_resolution_audit();
ALTER TABLE "BankRequestResolution" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BankRequestResolution" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_bank_request_resolution_guard(),erp_bank_request_resolution_audit() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON "BankRequestResolution" FROM %I',r);END IF;END LOOP;END $$;

-- Do not inherit API-role EXECUTE grants from installation-specific defaults.
DO $$ DECLARE r TEXT; signature TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   FOREACH signature IN ARRAY ARRAY['erp_validate_bank_match()','erp_bank_allocation_audit()','erp_bank_statement_correction()','erp_bank_statement_void_audit()','erp_bank_reconciliation_inputs(uuid,uuid)','erp_bank_certificate_guard()','erp_bank_request_resolution_guard()','erp_bank_request_resolution_audit()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,r);
   END LOOP;
  END IF;
 END LOOP;
END $$;
COMMIT;
