ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_tenantId_companyId_projectId_id_key" UNIQUE("tenantId","companyId","projectId",id);
CREATE TABLE "ProjectTaskDependency" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"projectId" UUID NOT NULL,"taskId" UUID NOT NULL,"dependsOnId" UUID NOT NULL,"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"removedBy" UUID,"removedAt" TIMESTAMP(3),
 CHECK("taskId"<>"dependsOnId"),CHECK(num_nulls("removedBy","removedAt") IN(0,2)),
 FOREIGN KEY("tenantId","companyId","projectId","taskId") REFERENCES "ProjectTask"("tenantId","companyId","projectId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","projectId","dependsOnId") REFERENCES "ProjectTask"("tenantId","companyId","projectId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ProjectTaskDependency_active_pair" ON "ProjectTaskDependency"("taskId","dependsOnId") WHERE "removedAt" IS NULL;
CREATE INDEX "ProjectTaskDependency_scope_idx" ON "ProjectTaskDependency"("tenantId","projectId","removedAt","createdAt",id);
CREATE INDEX "ProjectTaskDependency_task_idx" ON "ProjectTaskDependency"("taskId","removedAt");
CREATE INDEX "ProjectTaskDependency_prerequisite_idx" ON "ProjectTaskDependency"("dependsOnId","removedAt");
CREATE FUNCTION erp_task_dependency_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p "Project"%ROWTYPE;actor UUID;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dependency history cannot be deleted' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF p.id IS NULL OR p.status NOT IN('PLANNED','ACTIVE') OR NOT EXISTS(SELECT 1 FROM "ProjectTask" WHERE id=NEW."taskId" AND "projectId"=p.id AND status='TODO') THEN RAISE EXCEPTION 'Task dependencies are fixed after starting or project closure' USING ERRCODE='23514';END IF;
 actor:=CASE WHEN TG_OP='INSERT' THEN NEW."createdBy" ELSE NEW."removedBy" END;
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Dependency requires an active scoped actor' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."removedAt" IS NOT NULL OR NEW."removedBy" IS NOT NULL OR (SELECT count(*) FROM "ProjectTaskDependency" WHERE "projectId"=p.id)>=10000 OR (SELECT count(*) FROM "ProjectTaskDependency" WHERE "projectId"=p.id AND "removedAt" IS NULL)>=5000 OR NOT EXISTS(SELECT 1 FROM "ProjectTask" WHERE id=NEW."dependsOnId" AND "projectId"=p.id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Invalid prerequisite or project dependency limit reached' USING ERRCODE='23514';END IF;
  IF EXISTS(WITH RECURSIVE reachable(id) AS (SELECT NEW."dependsOnId" UNION SELECT d."dependsOnId" FROM "ProjectTaskDependency" d JOIN reachable r ON d."taskId"=r.id WHERE d."projectId"=p.id AND d."removedAt" IS NULL) SELECT 1 FROM reachable WHERE id=NEW."taskId") THEN RAISE EXCEPTION 'Dependency cycle is not allowed' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();
 ELSE
  IF OLD."removedAt" IS NOT NULL OR NEW."removedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['removedAt','removedBy']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['removedAt','removedBy']) THEN RAISE EXCEPTION 'Only removing an active dependency is allowed' USING ERRCODE='23514';END IF;
  NEW."removedAt":=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectTaskDependency" FOR EACH ROW EXECUTE FUNCTION erp_task_dependency_guard();
CREATE FUNCTION erp_task_dependency_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor UUID;action_name TEXT;version_number INTEGER;
BEGIN
 actor:=CASE WHEN TG_OP='INSERT' THEN NEW."createdBy" ELSE NEW."removedBy" END;action_name:=CASE WHEN TG_OP='INSERT' THEN 'project-task.dependency-added' ELSE 'project-task.dependency-removed' END;version_number:=CASE WHEN TG_OP='INSERT' THEN 1 ELSE 2 END;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=actor AND entity='ProjectTaskDependency' AND "entityId"=NEW.id::text AND action=action_name AND metadata->>'parentId'=NEW."projectId"::text AND metadata->>'version'=version_number::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Dependency requires its current transaction audit' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER task_dependency_audit AFTER INSERT OR UPDATE ON "ProjectTaskDependency" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_task_dependency_audit();
CREATE FUNCTION erp_task_prerequisites_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IN('IN_PROGRESS','DONE') AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
  PERFORM 1 FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "ProjectTaskDependency" d JOIN "ProjectTask" p ON p.id=d."dependsOnId" WHERE d."taskId"=NEW.id AND d."removedAt" IS NULL AND p.status<>'DONE') THEN RAISE EXCEPTION 'Unfinished project task prerequisites' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER task_prerequisites_guard BEFORE INSERT OR UPDATE ON "ProjectTask" FOR EACH ROW EXECUTE FUNCTION erp_task_prerequisites_guard();
ALTER TABLE "ProjectTaskDependency" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "ProjectTaskDependency" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "ProjectTaskDependency" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_task_dependency_guard(),erp_task_dependency_audit(),erp_task_prerequisites_guard() FROM PUBLIC;
