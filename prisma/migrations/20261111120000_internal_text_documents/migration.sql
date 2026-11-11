BEGIN;
-- Internal plain text only. Publish scope guards, history and privileges atomically.
CREATE TABLE "InternalTextDocument" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 title VARCHAR(200) NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),body TEXT NOT NULL CHECK(octet_length(body) BETWEEN 1 AND 65536),
 version INTEGER NOT NULL CHECK(version>0),archived BOOLEAN NOT NULL DEFAULT false,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX internal_text_document_register ON "InternalTextDocument"("tenantId","companyId","branchId",archived,"updatedAt",id);
CREATE TABLE "InternalTextDocumentRequest" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,"documentId" UUID NOT NULL,"createdBy" UUID NOT NULL,
 action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),"expectedVersion" INTEGER NOT NULL CHECK("expectedVersion" BETWEEN 0 AND 2147483646),
 request JSONB NOT NULL,outcome VARCHAR(9) NOT NULL CHECK(outcome IN ('COMMITTED','ABANDONED')),result JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "InternalTextDocumentRequest_tenantId_companyId_documentId_createdAt_idx" ON "InternalTextDocumentRequest"("tenantId","companyId","documentId","createdAt");
CREATE TABLE "InternalTextDocumentEvent" (
 id UUID PRIMARY KEY,"requestId" UUID NOT NULL UNIQUE,"documentId" UUID NOT NULL,
 "tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 version INTEGER NOT NULL CHECK(version>0),action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),
 title VARCHAR(200) NOT NULL,body TEXT NOT NULL CHECK(octet_length(body) BETWEEN 1 AND 65536),reason VARCHAR(300) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),archived BOOLEAN NOT NULL,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("documentId",version),
 FOREIGN KEY("tenantId","companyId","documentId") REFERENCES "InternalTextDocument"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","requestId") REFERENCES "InternalTextDocumentRequest"("tenantId","companyId",id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "InternalTextDocumentEvent_tenantId_companyId_documentId_version_idx" ON "InternalTextDocumentEvent"("tenantId","companyId","documentId",version);
INSERT INTO "Permission"(key) VALUES('document:read'),('document:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('document:read'),('document:manage')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;

CREATE FUNCTION erp_guard_internal_text_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Internal text projection is request-generated' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='InternalTextDocumentEvent' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Internal text history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='InternalTextDocument' AND TG_OP='UPDATE' AND
 (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM
 (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."createdBy",OLD."createdAt") THEN RAISE EXCEPTION 'Internal text ownership is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_internal_text_projection BEFORE INSERT OR UPDATE OR DELETE ON "InternalTextDocument" FOR EACH ROW EXECUTE FUNCTION erp_guard_internal_text_projection();
CREATE TRIGGER guard_internal_text_event BEFORE INSERT OR UPDATE OR DELETE ON "InternalTextDocumentEvent" FOR EACH ROW EXECUTE FUNCTION erp_guard_internal_text_projection();

CREATE FUNCTION erp_apply_internal_text_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d "InternalTextDocument"%ROWTYPE; e "InternalTextDocumentEvent"%ROWTYPE; p JSONB; expected JSONB; reason_text TEXT; has_document BOOLEAN;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Internal text requests are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Internal text writes require READ COMMITTED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'document:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'document:manage') THEN RAISE EXCEPTION 'Internal text read and manage scope required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('internal-text-request:'||NEW.id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('internal-text-document:'||NEW."documentId"::text,0));
 IF NEW.id=NEW."documentId" THEN RAISE EXCEPTION 'Separate document and request identities required' USING ERRCODE='23514'; END IF;
 p:=NEW.request;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'expectedActorId',NEW."createdBy",'requestId',NEW.id,'documentId',NEW."documentId",'action',NEW.action,'expectedVersion',NEW."expectedVersion",'reason',p->'reason');
 IF NEW.action IN ('create','edit') THEN expected:=expected||jsonb_build_object('title',p->'title','body',p->'body'); END IF;
 reason_text:=p->>'reason';
 IF p IS DISTINCT FROM expected OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR (length(btrim(reason_text))<1 OR length(reason_text)>300) OR reason_text ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Exact canonical internal text request required' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('create','edit') AND (jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'body') IS DISTINCT FROM 'string' OR (length(btrim(p->>'title'))<1 OR length(p->>'title')>200) OR p->>'title' ~ '[[:cntrl:]]' OR octet_length(p->>'body') NOT BETWEEN 1 AND 65536) THEN RAISE EXCEPTION 'Invalid internal text content bounds' USING ERRCODE='23514'; END IF;
 IF (NEW.action='create') IS DISTINCT FROM (NEW."expectedVersion"=0) THEN RAISE EXCEPTION 'Invalid expected document version' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM "InternalTextDocument" WHERE id=NEW."documentId" FOR UPDATE;
 has_document:=FOUND;
 IF has_document AND (d."tenantId",d."companyId",d."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") THEN RAISE EXCEPTION 'Document scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.action<>'create' AND NOT has_document THEN RAISE EXCEPTION 'Document not found' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp(); NEW.result:=NULL;
 IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
 IF (NEW.action='create' AND has_document) OR (NEW.action<>'create' AND d.version<>NEW."expectedVersion") THEN RAISE EXCEPTION 'Stale document version' USING ERRCODE='23514'; END IF;
 IF (NEW.action IN ('edit','archive') AND d.archived) OR (NEW.action='restore' AND NOT d.archived) THEN RAISE EXCEPTION 'Invalid document lifecycle' USING ERRCODE='23514'; END IF;
 IF NEW.action='create' THEN
 INSERT INTO "InternalTextDocument"(id,"tenantId","companyId","branchId",title,body,version,archived,"createdBy","createdAt","updatedAt") VALUES(NEW."documentId",NEW."tenantId",NEW."companyId",NEW."branchId",p->>'title',p->>'body',1,false,NEW."createdBy",NEW."createdAt",NEW."createdAt") RETURNING * INTO d;
 ELSE
 UPDATE "InternalTextDocument" SET title=CASE WHEN NEW.action='edit' THEN p->>'title' ELSE title END,body=CASE WHEN NEW.action='edit' THEN p->>'body' ELSE body END,version=version+1,archived=(NEW.action='archive'),"updatedAt"=NEW."createdAt" WHERE id=NEW."documentId" RETURNING * INTO d;
 END IF;
 INSERT INTO "InternalTextDocumentEvent"(id,"requestId","documentId","tenantId","companyId","branchId",version,action,title,body,reason,archived,"createdBy","createdAt") VALUES(gen_random_uuid(),NEW.id,d.id,d."tenantId",d."companyId",d."branchId",d.version,NEW.action,d.title,d.body,reason_text,d.archived,NEW."createdBy",NEW."createdAt") RETURNING * INTO e;
 NEW.result:=to_jsonb(e)||jsonb_build_object('createdAt',to_char(e."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN NEW;
END $$;
CREATE TRIGGER apply_internal_text_request BEFORE INSERT OR UPDATE OR DELETE ON "InternalTextDocumentRequest" FOR EACH ROW EXECUTE FUNCTION erp_apply_internal_text_request();
CREATE FUNCTION erp_audit_internal_text_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'internal-text.'||lower(NEW.outcome),'InternalTextDocumentRequest',NEW.id::text,jsonb_build_object('outcome',NEW.outcome),NEW."createdAt");
 RETURN NEW;
END $$;
CREATE TRIGGER audit_internal_text_request AFTER INSERT ON "InternalTextDocumentRequest" FOR EACH ROW EXECUTE FUNCTION erp_audit_internal_text_request();
CREATE FUNCTION erp_guard_internal_text_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity IN ('InternalTextDocument','InternalTextDocumentEvent','InternalTextDocumentRequest') THEN RAISE EXCEPTION 'Internal text audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity IN ('InternalTextDocument','InternalTextDocumentEvent','InternalTextDocumentRequest') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Internal text audit is request-generated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_internal_text_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_internal_text_audit();
-- TRUNCATE bypasses row triggers; preserve durable identities and mandatory audits.
CREATE FUNCTION erp_guard_internal_text_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Durable document and audit history cannot be truncated' USING ERRCODE='23514';
END $$;
CREATE TRIGGER guard_internal_text_truncate BEFORE TRUNCATE ON "InternalTextDocument" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_internal_text_truncate();
CREATE TRIGGER guard_internal_text_event_truncate BEFORE TRUNCATE ON "InternalTextDocumentEvent" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_internal_text_truncate();
CREATE TRIGGER guard_internal_text_request_truncate BEFORE TRUNCATE ON "InternalTextDocumentRequest" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_internal_text_truncate();
CREATE TRIGGER guard_internal_text_audit_truncate BEFORE TRUNCATE ON "AuditLog" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_internal_text_truncate();
ALTER TABLE "InternalTextDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InternalTextDocumentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InternalTextDocumentRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "InternalTextDocument","InternalTextDocumentEvent","InternalTextDocumentRequest" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_guard_internal_text_projection(),erp_apply_internal_text_request(),erp_audit_internal_text_request(),erp_guard_internal_text_audit(),erp_guard_internal_text_truncate() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "InternalTextDocument","InternalTextDocumentEvent","InternalTextDocumentRequest" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_guard_internal_text_projection(),erp_apply_internal_text_request(),erp_audit_internal_text_request(),erp_guard_internal_text_audit(),erp_guard_internal_text_truncate() FROM %I',r);
END IF; END LOOP; END $$;
COMMIT;
