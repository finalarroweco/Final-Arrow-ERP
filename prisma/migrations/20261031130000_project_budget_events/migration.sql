CREATE TABLE "ProjectBudgetEvent" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"projectId" UUID NOT NULL,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 5000),kind VARCHAR(20) NOT NULL CHECK(kind IN ('SET_BUDGET','COST','REVERSE_COST')),
 amount DECIMAL(18,3) NOT NULL CHECK(amount>=0),currency VARCHAR(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 "costDate" DATE,"reversesId" UUID UNIQUE,note VARCHAR(300) NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 300),
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"transactionId" TEXT NOT NULL DEFAULT (txid_current())::text,
 FOREIGN KEY("tenantId","companyId","projectId") REFERENCES "Project"("tenantId","companyId",id) ON DELETE RESTRICT,
 UNIQUE("tenantId","companyId","projectId",id),UNIQUE("projectId",sequence),
 FOREIGN KEY("tenantId","companyId","projectId","reversesId") REFERENCES "ProjectBudgetEvent"("tenantId","companyId","projectId",id) ON DELETE RESTRICT,
 CHECK((kind='SET_BUDGET' AND "costDate" IS NULL AND "reversesId" IS NULL) OR (kind='COST' AND amount>0 AND "costDate" IS NOT NULL AND "reversesId" IS NULL) OR (kind='REVERSE_COST' AND amount>0 AND "costDate" IS NOT NULL AND "reversesId" IS NOT NULL)),
 CHECK("costDate" IS NULL OR "costDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')
);
CREATE INDEX "ProjectBudgetEvent_tenantId_projectId_sequence_idx" ON "ProjectBudgetEvent"("tenantId","projectId",sequence);
CREATE FUNCTION erp_project_budget_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent RECORD; first_event RECORD; original_event RECORD; last_sequence INTEGER; base_currency TEXT;
BEGIN
 SELECT * INTO parent FROM "Project" WHERE id=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL OR parent.status NOT IN('PLANNED','ACTIVE','ON_HOLD') THEN RAISE EXCEPTION 'Budget project is closed or unavailable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."createdBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Budget event requires active scoped actor' USING ERRCODE='23514'; END IF;
 SELECT max(sequence) INTO last_sequence FROM "ProjectBudgetEvent" WHERE "tenantId"=NEW."tenantId" AND "projectId"=NEW."projectId";
 IF NEW.sequence<>coalesce(last_sequence,0)+1 THEN RAISE EXCEPTION 'Budget sequence changed' USING ERRCODE='23514'; END IF;
 SELECT * INTO first_event FROM "ProjectBudgetEvent" WHERE "projectId"=NEW."projectId" ORDER BY sequence LIMIT 1;
 IF first_event.id IS NULL THEN
  SELECT "baseCurrency" INTO base_currency FROM "Company" WHERE id=NEW."companyId";
  IF NEW.kind<>'SET_BUDGET' OR NEW.currency<>base_currency THEN RAISE EXCEPTION 'Initialize a budget in the company base currency' USING ERRCODE='23514'; END IF;
 ELSIF NEW.currency<>first_event.currency THEN RAISE EXCEPTION 'Project budget currency is permanent' USING ERRCODE='23514'; END IF;
 IF NEW.kind='COST' AND NEW."costDate">(clock_timestamp() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'Actual costs cannot be future dated' USING ERRCODE='23514'; END IF;
 IF NEW.kind='REVERSE_COST' THEN
  SELECT * INTO original_event FROM "ProjectBudgetEvent" WHERE id=NEW."reversesId" AND "projectId"=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId";
  IF original_event.id IS NULL OR original_event.kind<>'COST' OR original_event.amount<>NEW.amount OR original_event.currency<>NEW.currency OR original_event."costDate" IS DISTINCT FROM NEW."costDate" OR original_event.sequence>=NEW.sequence OR EXISTS(SELECT 1 FROM "ProjectBudgetEvent" WHERE "reversesId"=original_event.id) THEN RAISE EXCEPTION 'Cost reversal must exactly correct an unreversed project cost' USING ERRCODE='23514'; END IF;
 END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;
CREATE TRIGGER project_budget_guard BEFORE INSERT ON "ProjectBudgetEvent" FOR EACH ROW EXECUTE FUNCTION erp_project_budget_guard();
CREATE TRIGGER project_budget_immutable BEFORE UPDATE OR DELETE ON "ProjectBudgetEvent" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_project_budget_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity='ProjectBudgetEvent' AND a."entityId"=NEW.id::text AND a.action='project-budget.recorded' AND a.metadata->>'parentId'=NEW."projectId"::text AND a.metadata->>'version'=NEW.sequence::text AND a.metadata->>'transaction'=NEW."transactionId" AND NEW."transactionId"=txid_current()::text) THEN RAISE EXCEPTION 'Budget event requires same-transaction audit' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER project_budget_audit AFTER INSERT ON "ProjectBudgetEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_project_budget_audit();
CREATE FUNCTION erp_project_budget_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "ProjectBudgetEvent" WHERE "projectId"=OLD.id) THEN RAISE EXCEPTION 'Budget project scope is immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER project_budget_scope_guard BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION erp_project_budget_scope_guard();
ALTER TABLE "ProjectBudgetEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ProjectBudgetEvent" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_project_budget_guard(),erp_project_budget_audit(),erp_project_budget_scope_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "ProjectBudgetEvent" FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION erp_project_budget_guard(),erp_project_budget_audit(),erp_project_budget_scope_guard() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
INSERT INTO "Permission"(key) VALUES('project-budget:read'),('project-budget:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,key FROM "Role" CROSS JOIN (VALUES('project-budget:read'),('project-budget:manage')) AS p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
