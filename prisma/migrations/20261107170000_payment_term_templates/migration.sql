CREATE TABLE "PaymentTermTemplate" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 name VARCHAR(80) NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 80),
 label VARCHAR(120) NOT NULL CHECK(length(trim(label)) BETWEEN 3 AND 120),
 days INTEGER NOT NULL CHECK(days BETWEEN 0 AND 3650),
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,
 "archivedAt" TIMESTAMPTZ(3),"archivedBy" UUID,"archiveRequestId" UUID UNIQUE,"archiveReason" VARCHAR(200),"archiveTransaction" TEXT,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 CHECK(("archivedAt" IS NULL AND "archivedBy" IS NULL AND "archiveRequestId" IS NULL AND "archiveReason" IS NULL AND "archiveTransaction" IS NULL) OR
 ("archivedAt" IS NOT NULL AND "archivedBy" IS NOT NULL AND "archiveRequestId" IS NOT NULL AND length(trim("archiveReason")) BETWEEN 3 AND 200 AND "archiveReason" IS NOT NULL AND "archiveTransaction" IS NOT NULL))
);
CREATE UNIQUE INDEX "PaymentTermTemplate_active_name" ON "PaymentTermTemplate"("companyId",lower(trim(name))) WHERE "archivedAt" IS NULL;
CREATE INDEX "PaymentTermTemplate_tenantId_companyId_archivedAt_createdAt_id_idx" ON "PaymentTermTemplate"("tenantId","companyId","archivedAt","createdAt",id);
CREATE FUNCTION erp_payment_term_template_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor UUID;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment term template history cannot be deleted' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Template company unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."archivedAt" IS NOT NULL OR NEW."archivedBy" IS NOT NULL OR NEW."archiveRequestId" IS NOT NULL OR NEW."archiveReason" IS NOT NULL OR NEW."archiveTransaction" IS NOT NULL THEN RAISE EXCEPTION 'Templates must start active' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM "PaymentTermTemplate" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId")>=1000 THEN RAISE EXCEPTION 'Template history limit reached' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=clock_timestamp(); NEW."creationTransaction":=txid_current()::text; actor:=NEW."createdBy";
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW.name,NEW.label,NEW.days,NEW."createdBy",NEW."createdAt",NEW."creationTransaction") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD.name,OLD.label,OLD.days,OLD."createdBy",OLD."createdAt",OLD."creationTransaction") OR OLD."archivedAt" IS NOT NULL OR NEW."archivedBy" IS NULL OR NEW."archiveRequestId" IS NULL OR NEW."archiveReason" IS NULL THEN RAISE EXCEPTION 'Only one permanent template archive is allowed' USING ERRCODE='23514'; END IF;
  NEW."archivedAt":=clock_timestamp(); NEW."archiveTransaction":=txid_current()::text; actor:=NEW."archivedBy";
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Active template actor required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_term_template_guard BEFORE INSERT OR UPDATE OR DELETE ON "PaymentTermTemplate" FOR EACH ROW EXECUTE FUNCTION erp_payment_term_template_guard();
CREATE FUNCTION erp_payment_term_template_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor UUID; txn TEXT; action_name TEXT;
BEGIN
 IF TG_OP='INSERT' THEN actor:=NEW."createdBy";txn:=NEW."creationTransaction";action_name:='payment-term.created';
 ELSE actor:=NEW."archivedBy";txn:=NEW."archiveTransaction";action_name:='payment-term.archived'; END IF;
 IF txn<>txid_current()::text OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=actor AND entity='PaymentTermTemplate' AND "entityId"=NEW.id::text AND action=action_name AND metadata->>'companyId'=NEW."companyId"::text AND metadata->>'transaction'=txn AND (TG_OP='INSERT' OR metadata->>'requestId'=NEW."archiveRequestId"::text)) THEN RAISE EXCEPTION 'Template change requires same-transaction audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_term_template_audit AFTER INSERT OR UPDATE ON "PaymentTermTemplate" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_payment_term_template_audit();
ALTER TABLE "PaymentTermTemplate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PaymentTermTemplate" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_payment_term_template_guard(),erp_payment_term_template_audit() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "PaymentTermTemplate" FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION erp_payment_term_template_guard(),erp_payment_term_template_audit() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
INSERT INTO "Permission"(key) VALUES('payment-term:read'),('payment-term:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'payment-term:read' FROM "Role" WHERE name IN('Owner','Manager','Viewer') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'payment-term:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;
