-- A certificate records an internal observation, never a posting lock or approval.
CREATE FUNCTION erp_bank_reconciliation_inputs(sid UUID, tid UUID) RETURNS JSONB LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH s AS MATERIALIZED (SELECT s.*,c.name company_name,a.code account_code,a.name account_name FROM "BankStatement" s JOIN "Company" c ON c.id=s."companyId" JOIN "LedgerAccount" a ON a.id=s."accountId" WHERE s.id=sid AND s."tenantId"=tid),
 book AS (SELECT l.*,e.number,e."entryDate",e.description,e.currency FROM "JournalLine" l JOIN "JournalEntry" e ON e.id=l."entryId" JOIN s ON s."tenantId"=l."tenantId" AND s."companyId"=l."companyId" AND s."accountId"=l."accountId" WHERE e."entryDate"<=s."to" ORDER BY e."entryDate",l.id LIMIT 20001),
 bank AS (SELECT l.*,b.reference statement_reference,b."from" statement_from,b."to" statement_to,b.currency statement_currency,b."voidedAt" statement_voided,b."voidReason" statement_void_reason FROM "BankStatementLine" l JOIN "BankStatement" b ON b.id=l."statementId" JOIN s ON s."tenantId"=l."tenantId" AND s."companyId"=l."companyId" AND s."accountId"=l."accountId" WHERE l."bookingDate"<=s."to" AND (b."voidedAt" IS NULL OR b.id=s.id) ORDER BY l."bookingDate",l."statementId",l.position,l.id LIMIT 20001)
 SELECT jsonb_build_object('version',1,'tenantId',s."tenantId",'companyId',s."companyId",'accountId',s."accountId",'statementId',s.id,
 'company',jsonb_build_object('id',s."companyId",'name',s.company_name),'account',jsonb_build_object('id',s."accountId",'code',s.account_code,'name',s.account_name),
 'statement',jsonb_build_object('id',s.id,'reference',s.reference,'from',s."from",'to',s."to",'currency',s.currency,'opening',s.opening::text,'closing',s.closing::text,'voidedAt',to_char(s."voidedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'voidReason',s."voidReason",'createdAt',to_char(s."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',s."createdBy"),
 'book',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'entryId',b."entryId",'entryNumber',b.number,'entryDate',b."entryDate",'description',b.description,'currency',b.currency,'debit',b.debit::text,'credit',b.credit::text,'amount',(b.debit-b.credit)::text,
 'matchedThroughCutoff',EXISTS(SELECT 1 FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE m."journalLineId"=b.id AND m."cancelledAt" IS NULL AND l."bookingDate"<=s."to"),
 'match',(SELECT jsonb_build_object('id',m.id,'bankLineId',l.id,'statementId',l."statementId",'bookingDate',l."bookingDate",'amount',l.amount::text,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',m."createdBy") FROM "BankMatch" m JOIN "BankStatementLine" l ON l.id=m."bankLineId" WHERE m."journalLineId"=b.id AND m."cancelledAt" IS NULL)) ORDER BY b."entryDate",b.id) FROM book b),'[]'::jsonb),
 'bank',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'statementId',b."statementId",'statementReference',b.statement_reference,'statementFrom',b.statement_from,'statementTo',b.statement_to,'statementCurrency',b.statement_currency,'statementVoidedAt',to_char(b.statement_voided,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'statementVoidReason',b.statement_void_reason,'position',b.position,'bookingDate',b."bookingDate",'reference',b.reference,'amount',b.amount::text,
 'match',(SELECT jsonb_build_object('id',m.id,'journalLineId',l.id,'entryId',e.id,'entryNumber',e.number,'entryDate',e."entryDate",'currency',e.currency,'amount',(l.debit-l.credit)::text,'createdAt',to_char(m."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdBy',m."createdBy") FROM "BankMatch" m JOIN "JournalLine" l ON l.id=m."journalLineId" JOIN "JournalEntry" e ON e.id=l."entryId" WHERE m."bankLineId"=b.id AND m."cancelledAt" IS NULL)) ORDER BY b."bookingDate",b."statementId",b.position,b.id) FROM bank b),'[]'::jsonb)) FROM s;
$$;
-- Deterministic JSON for a content checksum, not a digital signature or approval.
CREATE FUNCTION erp_bank_certificate_canonical(value JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE jsonb_typeof(value)
 WHEN 'object' THEN '{'||coalesce((SELECT string_agg(to_jsonb(key)::text||':'||CASE WHEN jsonb_typeof(v) IN ('object','array') THEN erp_bank_certificate_canonical(v) ELSE v::text END,',' ORDER BY key COLLATE "C") FROM jsonb_each(value) e(key,v)),'')||'}'
 WHEN 'array' THEN '['||coalesce((SELECT string_agg(CASE WHEN jsonb_typeof(v) IN ('object','array') THEN erp_bank_certificate_canonical(v) ELSE v::text END,',' ORDER BY n) FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n)),'')||']'
 ELSE value::text END;
$$;
CREATE FUNCTION erp_bank_certificate_digest(value JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT encode(sha256(convert_to(erp_bank_certificate_canonical(value),'UTF8')),'hex');
$$;
CREATE TABLE "BankReconciliationCertificate" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,"statementId" UUID NOT NULL,
 snapshot JSONB NOT NULL,summary JSONB NOT NULL,digest VARCHAR(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),"requestDigest" VARCHAR(64) NOT NULL CHECK("requestDigest" ~ '^[a-f0-9]{64}$'),note VARCHAR(300) NOT NULL,
 "observedAt" TIMESTAMPTZ(3) NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdBy" UUID NOT NULL,"transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
 UNIQUE("tenantId","companyId","accountId",id),
 FOREIGN KEY("tenantId","companyId","accountId","statementId") REFERENCES "BankStatement"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX bank_certificate_statement_created ON "BankReconciliationCertificate"("tenantId","statementId","createdAt",id);
CREATE TABLE "BankReconciliationCertificateEvent" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"accountId" UUID NOT NULL,"certificateId" UUID NOT NULL,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),action VARCHAR(10) NOT NULL CHECK(action IN('SUPERSEDE','RESTORE')),"replacementId" UUID,
 reason VARCHAR(300) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 300),"requestDigest" VARCHAR(64) NOT NULL CHECK("requestDigest" ~ '^[a-f0-9]{64}$'),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
 UNIQUE("certificateId",sequence),
 CHECK((action='SUPERSEDE' AND "replacementId" IS NOT NULL AND "replacementId"<>"certificateId") OR (action='RESTORE' AND "replacementId" IS NULL)),
 CONSTRAINT bank_certificate_event_source_fk FOREIGN KEY("tenantId","companyId","accountId","certificateId") REFERENCES "BankReconciliationCertificate"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT bank_certificate_event_replacement_fk FOREIGN KEY("tenantId","companyId","accountId","replacementId") REFERENCES "BankReconciliationCertificate"("tenantId","companyId","accountId",id) ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION erp_require_bank_certificate_actor(tid UUID,cid UUID,actor UUID,required_permission TEXT) RETURNS VOID LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE permission_name TEXT;
BEGIN
 PERFORM 1 FROM "Tenant" WHERE id=tid FOR SHARE;
 FOREACH permission_name IN ARRAY ARRAY['ledger:read',required_permission] LOOP
  IF NOT EXISTS(SELECT 1 FROM "Membership" m JOIN "RoleGrant" g ON g."membershipId"=m.id AND g."tenantId"=m."tenantId" JOIN "RolePermission" p ON p."roleId"=g."roleId" AND p."tenantId"=g."tenantId" JOIN "AccessScope" s ON s."grantId"=g.id AND s."tenantId"=g."tenantId" WHERE m."tenantId"=tid AND m."userId"=actor AND m.status='ACTIVE' AND p."permissionKey"=permission_name AND (s.type='TENANT' OR (s.type='COMPANY' AND s."companyId"=cid))) THEN RAISE EXCEPTION 'Snapshot requires current company-wide permissions' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
CREATE FUNCTION erp_bank_certificate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE inputs JSONB; expected JSONB; book_total NUMERIC; outstanding NUMERIC; pending INTEGER; outstanding_count INTEGER; adjusted NUMERIC; canonical_snapshot TEXT;
BEGIN
 PERFORM erp_require_bank_certificate_actor(NEW."tenantId",NEW."companyId",NEW."createdBy",'bank-reconciliation:create');
 PERFORM 1 FROM "LedgerAccount" WHERE id=NEW."accountId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 inputs:=erp_bank_reconciliation_inputs(NEW."statementId",NEW."tenantId");
 IF inputs IS NULL OR NEW.snapshot-'summary' IS DISTINCT FROM inputs OR inputs->>'companyId'<>NEW."companyId"::text OR inputs->>'accountId'<>NEW."accountId"::text THEN RAISE EXCEPTION 'Snapshot sources changed or scope mismatch' USING ERRCODE='23514'; END IF;
 canonical_snapshot:=erp_bank_certificate_canonical(NEW.snapshot);
 IF jsonb_array_length(inputs->'book')>20000 OR jsonb_array_length(inputs->'bank')>20000 OR octet_length(convert_to(canonical_snapshot,'UTF8'))>16777216 THEN RAISE EXCEPTION 'Snapshot exceeds bounded inputs' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(inputs->'book') b WHERE b->>'currency'<>inputs#>>'{statement,currency}') OR EXISTS(SELECT 1 FROM jsonb_array_elements(inputs->'bank') b WHERE b->>'statementCurrency'<>inputs#>>'{statement,currency}') THEN RAISE EXCEPTION 'Snapshot cannot combine currencies' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum((b->>'amount')::numeric),0),coalesce(sum((b->>'amount')::numeric) FILTER(WHERE NOT (b->>'matchedThroughCutoff')::boolean),0),count(*) FILTER(WHERE NOT (b->>'matchedThroughCutoff')::boolean) INTO book_total,outstanding,outstanding_count FROM jsonb_array_elements(inputs->'book') b;
 IF outstanding_count>5000 THEN RAISE EXCEPTION 'Snapshot exceeds outstanding input limit' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO pending FROM jsonb_array_elements(inputs->'bank') b WHERE b->>'statementVoidedAt' IS NULL AND b->>'match' IS NULL;
 adjusted:=(inputs#>>'{statement,closing}')::numeric+outstanding;
 expected:=jsonb_build_object('bookClosing',book_total::numeric(24,3)::text,'outstandingTotal',outstanding::numeric(24,3)::text,'adjustedBank',adjusted::numeric(24,3)::text,'difference',(book_total-adjusted)::numeric(24,3)::text,'pendingBank',pending,'reconciled',inputs#>>'{statement,voidedAt}' IS NULL AND pending=0 AND book_total=adjusted,'bookLines',jsonb_array_length(inputs->'book'),'bankLines',jsonb_array_length(inputs->'bank'),'outstandingLines',outstanding_count);
 IF NEW.digest IS DISTINCT FROM encode(sha256(convert_to(canonical_snapshot,'UTF8')),'hex') THEN RAISE EXCEPTION 'Snapshot content digest mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.summary IS DISTINCT FROM expected OR NEW.snapshot->'summary' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Snapshot summary does not reconcile' USING ERRCODE='23514'; END IF;
 IF NEW."observedAt"<transaction_timestamp()-interval '1 millisecond' OR NEW."observedAt">clock_timestamp()+interval '1 second' THEN RAISE EXCEPTION 'Invalid snapshot observation time' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;
CREATE FUNCTION erp_bank_certificate_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source RECORD; replacement RECORD; previous RECORD;
BEGIN
 PERFORM erp_require_bank_certificate_actor(NEW."tenantId",NEW."companyId",NEW."createdBy",'bank-reconciliation:manage');
 SELECT * INTO source FROM "BankReconciliationCertificate" WHERE id=NEW."certificateId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "accountId"=NEW."accountId" FOR UPDATE;
 IF source.id IS NULL THEN RAISE EXCEPTION 'Snapshot event source or actor invalid' USING ERRCODE='23514'; END IF;
 SELECT * INTO previous FROM "BankReconciliationCertificateEvent" WHERE "certificateId"=source.id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(previous.sequence,0)+1 OR (NEW.action='RESTORE' AND previous.action IS DISTINCT FROM 'SUPERSEDE') OR (NEW.action='SUPERSEDE' AND previous.action='SUPERSEDE') THEN RAISE EXCEPTION 'Snapshot state changed' USING ERRCODE='23514'; END IF;
 IF NEW.action='SUPERSEDE' THEN
  SELECT * INTO replacement FROM "BankReconciliationCertificate" WHERE id=NEW."replacementId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "accountId"=NEW."accountId";
  IF replacement.id IS NULL OR replacement."createdAt"<=source."createdAt" OR replacement.snapshot#>>'{statement,from}' IS DISTINCT FROM source.snapshot#>>'{statement,from}' OR replacement.snapshot#>>'{statement,to}' IS DISTINCT FROM source.snapshot#>>'{statement,to}' OR replacement.snapshot#>>'{statement,currency}' IS DISTINCT FROM source.snapshot#>>'{statement,currency}' THEN RAISE EXCEPTION 'Replacement must be newer with the same account period and currency' USING ERRCODE='23514'; END IF;
 END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;
CREATE FUNCTION erp_bank_certificate_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE entity_name TEXT; action_name TEXT;
BEGIN
 entity_name:=TG_TABLE_NAME;IF TG_TABLE_NAME='BankReconciliationCertificate' THEN action_name:='bank-certificate.created';ELSE action_name:='bank-certificate.'||lower(NEW.action);END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity=entity_name AND "entityId"=NEW.id::text AND action=action_name AND metadata->>'transaction'=NEW."transactionId" AND NEW."transactionId"=txid_current()::text AND
 ((entity_name='BankReconciliationCertificate' AND metadata->>'statementId'=to_jsonb(NEW)->>'statementId' AND metadata->>'digest'=to_jsonb(NEW)->>'digest') OR
 (entity_name='BankReconciliationCertificateEvent' AND metadata->>'certificateId'=to_jsonb(NEW)->>'certificateId' AND metadata->>'sequence'=to_jsonb(NEW)->>'sequence'))) THEN RAISE EXCEPTION 'Snapshot change requires same-transaction audit' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE TRIGGER bank_certificate_guard BEFORE INSERT ON "BankReconciliationCertificate" FOR EACH ROW EXECUTE FUNCTION erp_bank_certificate_guard();
CREATE TRIGGER bank_certificate_event_guard BEFORE INSERT ON "BankReconciliationCertificateEvent" FOR EACH ROW EXECUTE FUNCTION erp_bank_certificate_event_guard();
CREATE TRIGGER bank_certificate_immutable BEFORE UPDATE OR DELETE ON "BankReconciliationCertificate" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE TRIGGER bank_certificate_event_immutable BEFORE UPDATE OR DELETE ON "BankReconciliationCertificateEvent" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE CONSTRAINT TRIGGER bank_certificate_audit AFTER INSERT ON "BankReconciliationCertificate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_bank_certificate_audit();
CREATE CONSTRAINT TRIGGER bank_certificate_event_audit AFTER INSERT ON "BankReconciliationCertificateEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_bank_certificate_audit();
ALTER TABLE "BankReconciliationCertificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankReconciliationCertificateEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "BankReconciliationCertificate","BankReconciliationCertificateEvent" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_bank_reconciliation_inputs(UUID,UUID),erp_bank_certificate_canonical(JSONB),erp_bank_certificate_digest(JSONB),erp_require_bank_certificate_actor(UUID,UUID,UUID,TEXT),erp_bank_certificate_guard(),erp_bank_certificate_event_guard(),erp_bank_certificate_audit() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON "BankReconciliationCertificate","BankReconciliationCertificateEvent" FROM %I',r); EXECUTE format('REVOKE ALL ON FUNCTION erp_bank_reconciliation_inputs(UUID,UUID),erp_bank_certificate_canonical(JSONB),erp_bank_certificate_digest(JSONB),erp_require_bank_certificate_actor(UUID,UUID,UUID,TEXT),erp_bank_certificate_guard(),erp_bank_certificate_event_guard(),erp_bank_certificate_audit() FROM %I',r); END IF; END LOOP; END $$;
INSERT INTO "Permission"(key) VALUES('bank-reconciliation:create'),('bank-reconciliation:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('bank-reconciliation:create'),('bank-reconciliation:manage')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
