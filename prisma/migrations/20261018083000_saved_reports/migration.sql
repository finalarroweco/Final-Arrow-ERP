CREATE TABLE "SavedReport" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,"ownerId" UUID NOT NULL,
 kind VARCHAR(24) NOT NULL CHECK(kind IN('CUSTOMER_BALANCES','CUSTOMER_AGING','SUPPLIER_BALANCES','SUPPLIER_AGING')),
 name VARCHAR(120) NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 120),"dateMode" VARCHAR(24) NOT NULL CHECK("dateMode" IN('FIXED','TODAY_UTC','PREVIOUS_MONTH_END_UTC')),"asOf" DATE,q VARCHAR(120) NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 1000),"creationDigest" VARCHAR(64) NOT NULL CHECK("creationDigest" ~ '^[a-f0-9]{64}$'),"lastRequestId" UUID NOT NULL,"lastRequestDigest" VARCHAR(64) NOT NULL CHECK("lastRequestDigest" ~ '^[a-f0-9]{64}$'),"archivedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(("dateMode"='FIXED' AND "asOf" IS NOT NULL AND "asOf">='0001-01-01'::date AND "asOf"<='9999-12-31'::date) OR ("dateMode"<>'FIXED' AND "asOf" IS NULL)),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","ownerId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SavedReport_owner_company_updated_idx" ON "SavedReport"("tenantId","ownerId","companyId","archivedAt","updatedAt",id);
CREATE FUNCTION erp_saved_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Saved reports must be archived' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  PERFORM 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."ownerId" AND status='ACTIVE' FOR UPDATE;
 ELSE
  PERFORM 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."ownerId" AND status='ACTIVE';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved reports require an active owner' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW."archivedAt" IS NOT NULL OR (SELECT count(*) FROM "SavedReport" WHERE "tenantId"=NEW."tenantId" AND "ownerId"=NEW."ownerId")>=100 THEN RAISE EXCEPTION 'Saved report creation limit or initial state invalid' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."ownerId",NEW.kind,NEW."creationDigest",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."ownerId",OLD.kind,OLD."creationDigest",OLD."createdAt") OR NEW.version<>OLD.version+1 OR NEW."lastRequestId"=OLD."lastRequestId" THEN RAISE EXCEPTION 'Saved report scope is immutable and version must advance' USING ERRCODE='23514';END IF;
 END IF;
 NEW."updatedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER saved_report_guard BEFORE INSERT OR UPDATE OR DELETE ON "SavedReport" FOR EACH ROW EXECUTE FUNCTION erp_saved_report_guard();
CREATE FUNCTION erp_saved_report_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."ownerId" AND entity='SavedReport' AND "entityId"=NEW.id::text AND action=CASE WHEN TG_OP='INSERT' THEN 'saved-report.created' ELSE 'saved-report.updated' END AND metadata->>'version'=NEW.version::text AND metadata->>'requestId'=NEW."lastRequestId"::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Saved report change requires its current transaction audit' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER saved_report_audit AFTER INSERT OR UPDATE ON "SavedReport" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_saved_report_audit();
ALTER TABLE "SavedReport" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "SavedReport" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "SavedReport" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_saved_report_guard(),erp_saved_report_audit() FROM PUBLIC;
