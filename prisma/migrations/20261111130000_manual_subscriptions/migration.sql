BEGIN;
-- Internal plain text only. Publish scope guards, history and privileges atomically.
CREATE TABLE "ManualSubscription" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 "customerId" UUID NOT NULL,"customerBranchId" UUID,"customerName" TEXT NOT NULL,"customerCode" TEXT NOT NULL,
 reference VARCHAR(40) NOT NULL, "serviceLabel" VARCHAR(200) NOT NULL CHECK(length(btrim("serviceLabel")) BETWEEN 1 AND 200),description TEXT NOT NULL CHECK(octet_length(description)<=65536),
 "agreementReference" VARCHAR(200) NOT NULL,status VARCHAR(7) NOT NULL CHECK(status IN ('PLANNED','ACTIVE','PAUSED','ENDED')),
 "startDate" DATE,"endDate" DATE,"nextReviewDate" DATE,
 CHECK("endDate" IS NULL OR "startDate" IS NULL OR "endDate">="startDate"),
 version INTEGER NOT NULL CHECK(version>0),archived BOOLEAN NOT NULL DEFAULT false,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ManualSubscription_tenantId_companyId_reference_key" ON "ManualSubscription"("tenantId","companyId",reference);
CREATE INDEX "ManualSubscription_tenantId_companyId_customerId_idx" ON "ManualSubscription"("tenantId","companyId","customerId");
CREATE INDEX manual_subscription_register ON "ManualSubscription"("tenantId","companyId","branchId",archived,"updatedAt",id);
CREATE TABLE "ManualSubscriptionRequest" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,"subscriptionId" UUID NOT NULL,"customerId" UUID NOT NULL,"createdBy" UUID NOT NULL,
 action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),"expectedVersion" INTEGER NOT NULL CHECK("expectedVersion" BETWEEN 0 AND 2147483646),
 request JSONB NOT NULL,outcome VARCHAR(9) NOT NULL CHECK(outcome IN ('COMMITTED','ABANDONED')),result JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "ManualSubscriptionRequest_tenantId_companyId_customerId_idx" ON "ManualSubscriptionRequest"("tenantId","companyId","customerId");
CREATE INDEX "ManualSubscriptionRequest_tenantId_companyId_subscriptionId_createdAt_idx" ON "ManualSubscriptionRequest"("tenantId","companyId","subscriptionId","createdAt");
CREATE TABLE "ManualSubscriptionRevision" (
 id UUID PRIMARY KEY,"requestId" UUID NOT NULL UNIQUE,"subscriptionId" UUID NOT NULL,
 "tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 version INTEGER NOT NULL CHECK(version>0),action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),
 "customerId" UUID NOT NULL,"customerBranchId" UUID,"customerName" TEXT NOT NULL,"customerCode" TEXT NOT NULL,
 reference VARCHAR(40) NOT NULL,"serviceLabel" VARCHAR(200) NOT NULL,description TEXT NOT NULL CHECK(octet_length(description)<=65536),
 "agreementReference" VARCHAR(200) NOT NULL,status VARCHAR(7) NOT NULL CHECK(status IN ('PLANNED','ACTIVE','PAUSED','ENDED')),
 "startDate" DATE,"endDate" DATE,"nextReviewDate" DATE,
 reason VARCHAR(300) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),archived BOOLEAN NOT NULL,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("subscriptionId",version),
 FOREIGN KEY("tenantId","companyId","subscriptionId") REFERENCES "ManualSubscription"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","requestId") REFERENCES "ManualSubscriptionRequest"("tenantId","companyId",id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "ManualSubscriptionRevision_tenantId_companyId_subscriptionId_version_idx" ON "ManualSubscriptionRevision"("tenantId","companyId","subscriptionId",version);
INSERT INTO "Permission"(key) VALUES('subscription:read'),('subscription:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('subscription:read'),('subscription:manage')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;

CREATE FUNCTION erp_guard_manual_subscription_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Manual subscription projection is request-generated' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ManualSubscriptionRevision' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Manual subscription history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ManualSubscription' AND TG_OP='UPDATE' AND
 (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy",NEW."createdAt",NEW."customerId",NEW."customerBranchId",NEW."customerName",NEW."customerCode",NEW.reference) IS DISTINCT FROM
 (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."createdBy",OLD."createdAt",OLD."customerId",OLD."customerBranchId",OLD."customerName",OLD."customerCode",OLD.reference) THEN RAISE EXCEPTION 'Manual subscription ownership is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_manual_subscription_projection BEFORE INSERT OR UPDATE OR DELETE ON "ManualSubscription" FOR EACH ROW EXECUTE FUNCTION erp_guard_manual_subscription_projection();
CREATE TRIGGER guard_manual_subscription_event BEFORE INSERT OR UPDATE OR DELETE ON "ManualSubscriptionRevision" FOR EACH ROW EXECUTE FUNCTION erp_guard_manual_subscription_projection();

CREATE FUNCTION erp_apply_manual_subscription_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d "ManualSubscription"%ROWTYPE; e "ManualSubscriptionRevision"%ROWTYPE; c "Customer"%ROWTYPE; p JSONB; expected JSONB; reason_text TEXT; has_subscription BOOLEAN; field_name TEXT; date_value DATE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Manual subscription requests are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Manual subscription writes require READ COMMITTED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-subscription-request:'||NEW.id::text,0));
 SELECT * INTO c FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR SHARE;
 IF NOT FOUND OR (c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId") THEN RAISE EXCEPTION 'Manual subscription source scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('manual-subscription:'||NEW."subscriptionId"::text,0));
 SELECT * INTO d FROM "ManualSubscription" WHERE id=NEW."subscriptionId" FOR UPDATE;
 has_subscription:=FOUND;
 -- READ COMMITTED fresh permission checks occur after every potentially blocking lock.
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'subscription:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'subscription:manage') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",c."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Manual subscription read/manage and source read scope required' USING ERRCODE='23514'; END IF;
 IF NEW.id=NEW."subscriptionId" THEN RAISE EXCEPTION 'Separate subscription and request identities required' USING ERRCODE='23514'; END IF;
 p:=NEW.request;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'customerId',NEW."customerId",'expectedActorId',NEW."createdBy",'requestId',NEW.id,'subscriptionId',NEW."subscriptionId",'action',NEW.action,'expectedVersion',NEW."expectedVersion",'reason',p->'reason');
 IF NEW.action IN ('create','edit') THEN
 expected:=expected||jsonb_build_object('serviceLabel',p->'serviceLabel','description',p->'description','agreementReference',p->'agreementReference','status',p->'status','startDate',p->'startDate','endDate',p->'endDate','nextReviewDate',p->'nextReviewDate');
 END IF;
 reason_text:=p->>'reason';
 IF p IS DISTINCT FROM expected OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(reason_text))<1 OR length(reason_text)>300 OR reason_text ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Exact canonical manual subscription request required' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('create','edit') THEN
 IF jsonb_typeof(p->'serviceLabel') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'description') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'agreementReference') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'status') IS DISTINCT FROM 'string' OR length(btrim(p->>'serviceLabel'))<1 OR length(p->>'serviceLabel')>200 OR p->>'serviceLabel' ~ '[[:cntrl:]]' OR length(p->>'agreementReference')>200 OR p->>'agreementReference' ~ '[[:cntrl:]]' OR octet_length(p->>'description')>65536 OR (p->>'status') NOT IN ('PLANNED','ACTIVE','PAUSED','ENDED') THEN RAISE EXCEPTION 'Invalid manual subscription content bounds' USING ERRCODE='23514'; END IF;
 FOREACH field_name IN ARRAY ARRAY['startDate','endDate','nextReviewDate'] LOOP
  IF jsonb_typeof(p->field_name) IS DISTINCT FROM 'null' THEN
   IF jsonb_typeof(p->field_name) IS DISTINCT FROM 'string' OR (p->>field_name) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(p->>field_name,4)='0000' THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='23514'; END IF;
   BEGIN date_value:=(p->>field_name)::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='23514'; END;
   IF to_char(date_value,'YYYY-MM-DD')<>p->>field_name THEN RAISE EXCEPTION 'Invalid calendar date' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF (p->>'endDate')::date < (p->>'startDate')::date THEN RAISE EXCEPTION 'End date precedes start date' USING ERRCODE='23514'; END IF;
 END IF;
 IF (NEW.action='create') IS DISTINCT FROM (NEW."expectedVersion"=0) THEN RAISE EXCEPTION 'Invalid expected subscription version' USING ERRCODE='23514'; END IF;
 IF has_subscription AND (d."tenantId",d."companyId",d."branchId",d."customerId",d."customerBranchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",c."branchId") THEN RAISE EXCEPTION 'Subscription source scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.action<>'create' AND NOT has_subscription THEN RAISE EXCEPTION 'Subscription not found' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp(); NEW.result:=NULL;
 IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
 IF (NEW.action='create' AND has_subscription) OR (NEW.action<>'create' AND d.version<>NEW."expectedVersion") THEN RAISE EXCEPTION 'Stale subscription version' USING ERRCODE='23514'; END IF;
 IF (NEW.action IN ('edit','archive') AND d.archived) OR (NEW.action='restore' AND NOT d.archived) THEN RAISE EXCEPTION 'Invalid subscription lifecycle' USING ERRCODE='23514'; END IF;
 IF NEW.action='create' THEN
 IF c."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'New subscription requires nonarchived customer' USING ERRCODE='23514'; END IF;
 INSERT INTO "ManualSubscription"(id,"tenantId","companyId","branchId","customerId","customerBranchId","customerName","customerCode",reference,"serviceLabel",description,"agreementReference",status,"startDate","endDate","nextReviewDate",version,archived,"createdBy","createdAt","updatedAt") VALUES(NEW."subscriptionId",NEW."tenantId",NEW."companyId",NEW."branchId",c.id,c."branchId",c."displayName",c.code,'SUB-'||NEW."subscriptionId"::text,p->>'serviceLabel',p->>'description',p->>'agreementReference',p->>'status',(p->>'startDate')::date,(p->>'endDate')::date,(p->>'nextReviewDate')::date,1,false,NEW."createdBy",NEW."createdAt",NEW."createdAt") RETURNING * INTO d;
 ELSE
 UPDATE "ManualSubscription" SET "serviceLabel"=CASE WHEN NEW.action='edit' THEN p->>'serviceLabel' ELSE "serviceLabel" END,
 description=CASE WHEN NEW.action='edit' THEN p->>'description' ELSE description END,
 "agreementReference"=CASE WHEN NEW.action='edit' THEN p->>'agreementReference' ELSE "agreementReference" END,
 status=CASE WHEN NEW.action='edit' THEN p->>'status' ELSE status END,
 "startDate"=CASE WHEN NEW.action='edit' THEN (p->>'startDate')::date ELSE "startDate" END,
 "endDate"=CASE WHEN NEW.action='edit' THEN (p->>'endDate')::date ELSE "endDate" END,
 "nextReviewDate"=CASE WHEN NEW.action='edit' THEN (p->>'nextReviewDate')::date ELSE "nextReviewDate" END,
 version=version+1,archived=(NEW.action='archive'),"updatedAt"=NEW."createdAt" WHERE id=NEW."subscriptionId" RETURNING * INTO d;
 END IF;
 INSERT INTO "ManualSubscriptionRevision"(id,"requestId","subscriptionId","tenantId","companyId","branchId","customerId","customerBranchId","customerName","customerCode",reference,"serviceLabel",description,"agreementReference",status,"startDate","endDate","nextReviewDate",version,action,reason,archived,"createdBy","createdAt") VALUES(gen_random_uuid(),NEW.id,d.id,d."tenantId",d."companyId",d."branchId",d."customerId",d."customerBranchId",d."customerName",d."customerCode",d.reference,d."serviceLabel",d.description,d."agreementReference",d.status,d."startDate",d."endDate",d."nextReviewDate",d.version,NEW.action,reason_text,d.archived,NEW."createdBy",NEW."createdAt") RETURNING * INTO e;
 NEW.result:=to_jsonb(e)||jsonb_build_object('createdAt',to_char(e."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN NEW;
END $$;
CREATE TRIGGER apply_manual_subscription_request BEFORE INSERT OR UPDATE OR DELETE ON "ManualSubscriptionRequest" FOR EACH ROW EXECUTE FUNCTION erp_apply_manual_subscription_request();
-- Preserve actual customer authorization scope for records and durable abandoned requests.
-- No contact fields are copied. Name/code changes and archival remain ordinary customer operations.
CREATE FUNCTION erp_guard_manual_subscription_customer() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND
 (EXISTS(SELECT 1 FROM "ManualSubscription" WHERE "customerId"=OLD.id) OR EXISTS(SELECT 1 FROM "ManualSubscriptionRequest" WHERE "customerId"=OLD.id)) THEN
 RAISE EXCEPTION 'Manual subscription source identity and scope are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_manual_subscription_customer BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION erp_guard_manual_subscription_customer();

CREATE FUNCTION erp_audit_manual_subscription_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'manual-subscription.'||lower(NEW.outcome),'ManualSubscriptionRequest',NEW.id::text,jsonb_build_object('outcome',NEW.outcome),NEW."createdAt");
 RETURN NEW;
END $$;
CREATE TRIGGER audit_manual_subscription_request AFTER INSERT ON "ManualSubscriptionRequest" FOR EACH ROW EXECUTE FUNCTION erp_audit_manual_subscription_request();
CREATE FUNCTION erp_guard_manual_subscription_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity IN ('ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest') THEN RAISE EXCEPTION 'Manual subscription audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity IN ('ManualSubscription','ManualSubscriptionRevision','ManualSubscriptionRequest') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Manual subscription audit is request-generated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_manual_subscription_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_manual_subscription_audit();
-- TRUNCATE bypasses row triggers; preserve durable identities and mandatory audits.
CREATE FUNCTION erp_guard_manual_subscription_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Durable document and audit history cannot be truncated' USING ERRCODE='23514';
END $$;
CREATE TRIGGER guard_manual_subscription_truncate BEFORE TRUNCATE ON "ManualSubscription" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE TRIGGER guard_manual_subscription_event_truncate BEFORE TRUNCATE ON "ManualSubscriptionRevision" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE TRIGGER guard_manual_subscription_request_truncate BEFORE TRUNCATE ON "ManualSubscriptionRequest" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
-- AuditLog already has its shared immutable TRUNCATE guard from migration 77.
ALTER TABLE "ManualSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualSubscriptionRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ManualSubscriptionRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ManualSubscription","ManualSubscriptionRevision","ManualSubscriptionRequest" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_guard_manual_subscription_projection(),erp_apply_manual_subscription_request(),erp_audit_manual_subscription_request(),erp_guard_manual_subscription_audit(),erp_guard_manual_subscription_truncate(),erp_guard_manual_subscription_customer() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "ManualSubscription","ManualSubscriptionRevision","ManualSubscriptionRequest" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_guard_manual_subscription_projection(),erp_apply_manual_subscription_request(),erp_audit_manual_subscription_request(),erp_guard_manual_subscription_audit(),erp_guard_manual_subscription_truncate(),erp_guard_manual_subscription_customer() FROM %I',r);
END IF; END LOOP; END $$;
COMMIT;
