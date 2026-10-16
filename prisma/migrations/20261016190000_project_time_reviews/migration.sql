ALTER TABLE "ProjectTimeEntry" ADD COLUMN "reviewState" VARCHAR(10) NOT NULL DEFAULT 'PENDING',ADD COLUMN "reviewSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_review_state" CHECK("reviewState" IN('PENDING','APPROVED','REJECTED') AND "reviewSequence" BETWEEN 0 AND 1000 AND ("reviewSequence">0 OR "reviewState"='PENDING'));
ALTER TABLE "ProjectTimeEntry" ADD CONSTRAINT "ProjectTimeEntry_tenantId_companyId_projectId_id_key" UNIQUE("tenantId","companyId","projectId",id);
CREATE TABLE "ProjectTimeReview" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"projectId" UUID NOT NULL,"entryId" UUID NOT NULL,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),state VARCHAR(10) NOT NULL CHECK(state IN('PENDING','APPROVED','REJECTED')),reason VARCHAR(500) NOT NULL CHECK(length(trim(reason))>=3),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId","projectId","entryId") REFERENCES "ProjectTimeEntry"("tenantId","companyId","projectId",id) ON DELETE RESTRICT,UNIQUE("entryId",sequence)
);
CREATE INDEX "ProjectTimeReview_scope_sequence_idx" ON "ProjectTimeReview"("tenantId","projectId","entryId",sequence);
CREATE INDEX "ProjectTimeEntry_review_state_idx" ON "ProjectTimeEntry"("tenantId","projectId","reviewState","voidedAt");
CREATE FUNCTION erp_project_time_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Project time history cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."reviewState"<>'PENDING' OR NEW."reviewSequence"<>0 THEN RAISE EXCEPTION 'New time must await review' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 PERFORM 1 FROM "Project" WHERE id=OLD."projectId" FOR UPDATE;
 IF ROW(NEW."reviewState",NEW."reviewSequence") IS DISTINCT FROM ROW(OLD."reviewState",OLD."reviewSequence") THEN
  IF pg_trigger_depth()<2 OR NEW."reviewSequence"<>OLD."reviewSequence"+1 OR (to_jsonb(NEW)-ARRAY['reviewState','reviewSequence']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reviewState','reviewSequence']) OR NOT EXISTS(SELECT 1 FROM "ProjectTimeReview" WHERE "entryId"=OLD.id AND sequence=NEW."reviewSequence" AND state=NEW."reviewState") THEN RAISE EXCEPTION 'Time review state requires its immutable decision' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['voidedAt','voidReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voidedAt','voidReason']) OR OLD."voidedAt" IS NOT NULL OR NEW."voidedAt" IS NULL OR length(trim(COALESCE(NEW."voidReason",'')))<3 OR OLD."reviewState"='APPROVED' OR NOT EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId" AND status IN('PLANNED','ACTIVE','ON_HOLD')) THEN RAISE EXCEPTION 'Reset approved time before correction; original time is immutable' USING ERRCODE='23514';END IF;
  NEW."voidedAt":=clock_timestamp();
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER project_time_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectTimeEntry" FOR EACH ROW EXECUTE FUNCTION erp_project_time_snapshot_guard();
CREATE FUNCTION erp_project_time_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE e "ProjectTimeEntry"%ROWTYPE;p "Project"%ROWTYPE;
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 SELECT * INTO e FROM "ProjectTimeEntry" WHERE id=NEW."entryId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "projectId"=NEW."projectId";
 IF p.id IS NULL OR p.status NOT IN('PLANNED','ACTIVE','ON_HOLD') OR e.id IS NULL OR e."voidedAt" IS NOT NULL OR NEW.sequence<>e."reviewSequence"+1 OR NOT ((e."reviewState"='PENDING' AND NEW.state IN('APPROVED','REJECTED')) OR (e."reviewState" IN('APPROVED','REJECTED') AND NEW.state='PENDING')) THEN RAISE EXCEPTION 'Time review changed, source voided or project closed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."createdBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Review requires an active scoped actor' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER project_time_review_guard BEFORE INSERT ON "ProjectTimeReview" FOR EACH ROW EXECUTE FUNCTION erp_project_time_review_guard();
CREATE TRIGGER project_time_review_immutable BEFORE UPDATE OR DELETE ON "ProjectTimeReview" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_project_time_review_apply() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN UPDATE "ProjectTimeEntry" SET "reviewState"=NEW.state,"reviewSequence"=NEW.sequence WHERE id=NEW."entryId";RETURN NEW;END $$;
CREATE TRIGGER project_time_review_apply AFTER INSERT ON "ProjectTimeReview" FOR EACH ROW EXECUTE FUNCTION erp_project_time_review_apply();
CREATE FUNCTION erp_project_time_review_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='ProjectTimeReview' AND "entityId"=NEW.id::text AND action='project-time.reviewed' AND metadata->>'parentId'=NEW."projectId"::text AND metadata->>'entryId'=NEW."entryId"::text AND metadata->>'state'=NEW.state AND metadata->>'version'=NEW.sequence::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Time review requires its current transaction audit' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER project_time_review_audit AFTER INSERT ON "ProjectTimeReview" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_project_time_review_audit();
INSERT INTO "Permission"(key) VALUES('project-time:approve') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'project-time:approve' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;
ALTER TABLE "ProjectTimeReview" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ProjectTimeReview" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ProjectTimeReview" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_project_time_snapshot_guard(),erp_project_time_review_guard(),erp_project_time_review_apply(),erp_project_time_review_audit() FROM PUBLIC;
