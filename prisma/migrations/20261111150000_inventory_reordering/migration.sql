BEGIN;
-- Current manual reorder observations only. No policy or stock rows are backfilled.
ALTER TABLE "InventoryItem" ADD COLUMN "reorderUnitVersion" INTEGER NOT NULL DEFAULT 0 CHECK("reorderUnitVersion">=0);
CREATE FUNCTION erp_guard_reorder_item_unit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."reorderUnitVersion"<>0 THEN RAISE EXCEPTION 'Initial reorder unit version must be zero' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."reorderUnitVersion" IS DISTINCT FROM OLD."reorderUnitVersion" THEN RAISE EXCEPTION 'Reorder unit version is database maintained' USING ERRCODE='23514'; END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit THEN NEW."reorderUnitVersion":=OLD."reorderUnitVersion"+1; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_reorder_item_unit BEFORE INSERT OR UPDATE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION erp_guard_reorder_item_unit();
CREATE TABLE "InventoryReorderPolicy" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID NOT NULL,
 "itemId" UUID NOT NULL REFERENCES "InventoryItem"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "itemBranchId" UUID,"itemName" TEXT NOT NULL,"itemSku" TEXT NOT NULL,
 unit VARCHAR(16) NOT NULL,"unitVersion" INTEGER NOT NULL CHECK("unitVersion">=0),reference VARCHAR(40) NOT NULL,
 "minimumQuantity" NUMERIC(18,3) NOT NULL CHECK("minimumQuantity">=0),"targetQuantity" NUMERIC(18,3) NOT NULL CHECK("targetQuantity">="minimumQuantity"),
 version INTEGER NOT NULL CHECK(version>0),archived BOOLEAN NOT NULL DEFAULT false,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),UNIQUE("tenantId","companyId",reference),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
-- At most one active policy per branch/item, even across units or unit generations.
CREATE UNIQUE INDEX inventory_reorder_active_item ON "InventoryReorderPolicy"("tenantId","companyId","branchId","itemId") WHERE NOT archived;
CREATE INDEX inventory_reorder_register ON "InventoryReorderPolicy"("tenantId","companyId","branchId",archived,"updatedAt",id);
CREATE INDEX "InventoryReorderPolicy_itemId_idx" ON "InventoryReorderPolicy"("itemId");
CREATE TABLE "InventoryReorderRequest" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID NOT NULL,"policyId" UUID NOT NULL,
 "itemId" UUID NOT NULL,"createdBy" UUID NOT NULL,
 action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),"expectedVersion" INTEGER NOT NULL CHECK("expectedVersion" BETWEEN 0 AND 2147483646),
 request JSONB NOT NULL,outcome VARCHAR(9) NOT NULL CHECK(outcome IN ('COMMITTED','ABANDONED')),result JSONB,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "InventoryReorderRequest_itemId_idx" ON "InventoryReorderRequest"("itemId");
CREATE INDEX "InventoryReorderRequest_tenantId_companyId_policyId_createdAt_idx" ON "InventoryReorderRequest"("tenantId","companyId","policyId","createdAt");
CREATE TABLE "InventoryReorderRevision" (
 id UUID PRIMARY KEY,"requestId" UUID NOT NULL UNIQUE,"policyId" UUID NOT NULL,
 "tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID NOT NULL,"itemId" UUID NOT NULL,
 "itemBranchId" UUID,"itemName" TEXT NOT NULL,"itemSku" TEXT NOT NULL,unit VARCHAR(16) NOT NULL,"unitVersion" INTEGER NOT NULL CHECK("unitVersion">=0),reference VARCHAR(40) NOT NULL,
 "minimumQuantity" NUMERIC(18,3) NOT NULL CHECK("minimumQuantity">=0),"targetQuantity" NUMERIC(18,3) NOT NULL CHECK("targetQuantity">="minimumQuantity"),
 version INTEGER NOT NULL CHECK(version>0),action VARCHAR(7) NOT NULL CHECK(action IN ('create','edit','archive','restore')),reason VARCHAR(300) NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 300),archived BOOLEAN NOT NULL,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("policyId",version),
 FOREIGN KEY("tenantId","companyId","policyId") REFERENCES "InventoryReorderPolicy"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","requestId") REFERENCES "InventoryReorderRequest"("tenantId","companyId",id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "InventoryReorderRevision_tenantId_companyId_policyId_version_idx" ON "InventoryReorderRevision"("tenantId","companyId","policyId",version);
INSERT INTO "Permission"(key) VALUES('inventory-reorder:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'inventory-reorder:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;
CREATE FUNCTION erp_guard_reorder_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Reorder projection is request-generated' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='InventoryReorderRevision' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Reorder history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='InventoryReorderPolicy' AND TG_OP='UPDATE' AND
 (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy",NEW."createdAt",NEW."itemId",NEW."itemBranchId",NEW."itemName",NEW."itemSku",NEW.unit,NEW."unitVersion",NEW.reference) IS DISTINCT FROM
 (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."createdBy",OLD."createdAt",OLD."itemId",OLD."itemBranchId",OLD."itemName",OLD."itemSku",OLD.unit,OLD."unitVersion",OLD.reference) THEN RAISE EXCEPTION 'Reorder policy identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_reorder_projection BEFORE INSERT OR UPDATE OR DELETE ON "InventoryReorderPolicy" FOR EACH ROW EXECUTE FUNCTION erp_guard_reorder_projection();
CREATE TRIGGER guard_reorder_revision BEFORE INSERT OR UPDATE OR DELETE ON "InventoryReorderRevision" FOR EACH ROW EXECUTE FUNCTION erp_guard_reorder_projection();
CREATE FUNCTION erp_apply_reorder_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d "InventoryReorderPolicy"%ROWTYPE; e "InventoryReorderRevision"%ROWTYPE; i "InventoryItem"%ROWTYPE; p JSONB; expected JSONB; reason_text TEXT; has_policy BOOLEAN; field_name TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Reorder requests are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Reorder writes require READ COMMITTED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-reorder-request:'||NEW.id::text,0));
 SELECT * INTO i FROM "InventoryItem" WHERE id=NEW."itemId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('inventory-reorder:'||NEW."policyId"::text,0));
 SELECT * INTO d FROM "InventoryReorderPolicy" WHERE id=NEW."policyId" FOR UPDATE;
 has_policy:=FOUND;
 -- Fresh checks after potentially blocking locks; exact independent permissions at policy branch.
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'inventory-stock:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'inventory-reorder:manage') THEN RAISE EXCEPTION 'Current branch stock read and reorder manage required' USING ERRCODE='23514'; END IF;
 IF NEW.id=NEW."policyId" THEN RAISE EXCEPTION 'Separate policy and request identities required' USING ERRCODE='23514'; END IF;
 p:=NEW.request;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'itemId',NEW."itemId",'unit',p->'unit','unitVersion',p->'unitVersion','expectedActorId',NEW."createdBy",'requestId',NEW.id,'policyId',NEW."policyId",'action',NEW.action,'expectedVersion',NEW."expectedVersion",'reason',p->'reason');
 IF NEW.action IN ('create','edit') THEN expected:=expected||jsonb_build_object('minimumQuantity',p->'minimumQuantity','targetQuantity',p->'targetQuantity'); END IF;
 reason_text:=p->>'reason';
 IF p IS DISTINCT FROM expected OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(reason_text))<1 OR reason_text ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$' OR length(reason_text)>300 OR reason_text ~ '[[:cntrl:]]' OR jsonb_typeof(p->'unit') IS DISTINCT FROM 'string' OR length(p->>'unit')>16 OR jsonb_typeof(p->'unitVersion') IS DISTINCT FROM 'number' OR (p->>'unitVersion') !~ '^(0|[1-9][0-9]{0,9})$' OR (p->>'unitVersion')::numeric>2147483647 THEN RAISE EXCEPTION 'Exact canonical reorder request required' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('create','edit') THEN
  FOREACH field_name IN ARRAY ARRAY['minimumQuantity','targetQuantity'] LOOP
   IF jsonb_typeof(p->field_name) IS DISTINCT FROM 'string' OR (p->>field_name) !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' THEN RAISE EXCEPTION 'Exact nonnegative three-decimal reorder quantities required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (p->>'targetQuantity')::numeric<(p->>'minimumQuantity')::numeric THEN RAISE EXCEPTION 'Reorder target must not be below minimum' USING ERRCODE='23514'; END IF;
 END IF;
 IF (NEW.action='create') IS DISTINCT FROM (NEW."expectedVersion"=0) THEN RAISE EXCEPTION 'Invalid expected reorder version' USING ERRCODE='23514'; END IF;
 IF has_policy AND (d."tenantId",d."companyId",d."branchId",d."itemId",d.unit,d."unitVersion") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."itemId",p->>'unit',(p->>'unitVersion')::integer) THEN RAISE EXCEPTION 'Reorder policy identity mismatch' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp(); NEW.result:=NULL;
 -- Terminal tombstones contain supplied identities only, never source labels or stock.
 -- Permit abandoning stale source/unit/version requests; no projection mutation occurs.
 IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
 IF NEW.action<>'create' AND NOT has_policy THEN RAISE EXCEPTION 'Reorder policy not found' USING ERRCODE='23514'; END IF;
 IF (NEW.action='create' AND has_policy) OR (NEW.action<>'create' AND d.version<>NEW."expectedVersion") THEN RAISE EXCEPTION 'Stale reorder version' USING ERRCODE='23514'; END IF;
 IF (NEW.action IN ('edit','archive') AND d.archived) OR (NEW.action='restore' AND NOT d.archived) THEN RAISE EXCEPTION 'Invalid reorder lifecycle' USING ERRCODE='23514'; END IF;
 IF NEW.action<>'archive' AND (i.id IS NULL OR (i."tenantId",i."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR (i."branchId" IS NOT NULL AND i."branchId"<>NEW."branchId") OR i."archivedAt" IS NOT NULL OR i.unit<>p->>'unit' OR i."reorderUnitVersion"<>(p->>'unitVersion')::integer) THEN RAISE EXCEPTION 'Current eligible source and unchanged unit generation required' USING ERRCODE='23514'; END IF;
 IF NEW.action='create' THEN
 INSERT INTO "InventoryReorderPolicy"(id,"tenantId","companyId","branchId","itemId","itemBranchId","itemName","itemSku",unit,"unitVersion",reference,"minimumQuantity","targetQuantity",version,archived,"createdBy","createdAt","updatedAt") VALUES(NEW."policyId",NEW."tenantId",NEW."companyId",NEW."branchId",i.id,i."branchId",i.name,i.sku,i.unit,i."reorderUnitVersion",'REO-'||NEW."policyId"::text,(p->>'minimumQuantity')::numeric,(p->>'targetQuantity')::numeric,1,false,NEW."createdBy",NEW."createdAt",NEW."createdAt") RETURNING * INTO d;
 ELSE
 UPDATE "InventoryReorderPolicy" SET "minimumQuantity"=CASE WHEN NEW.action='edit' THEN (p->>'minimumQuantity')::numeric ELSE "minimumQuantity" END,"targetQuantity"=CASE WHEN NEW.action='edit' THEN (p->>'targetQuantity')::numeric ELSE "targetQuantity" END,version=version+1,archived=(NEW.action='archive'),"updatedAt"=NEW."createdAt" WHERE id=NEW."policyId" RETURNING * INTO d;
 END IF;
 INSERT INTO "InventoryReorderRevision"(id,"requestId","policyId","tenantId","companyId","branchId","itemId","itemBranchId","itemName","itemSku",unit,"unitVersion",reference,"minimumQuantity","targetQuantity",version,action,reason,archived,"createdBy","createdAt") VALUES(gen_random_uuid(),NEW.id,d.id,d."tenantId",d."companyId",d."branchId",d."itemId",d."itemBranchId",d."itemName",d."itemSku",d.unit,d."unitVersion",d.reference,d."minimumQuantity",d."targetQuantity",d.version,NEW.action,reason_text,d.archived,NEW."createdBy",NEW."createdAt") RETURNING * INTO e;
 NEW.result:=to_jsonb(e)||jsonb_build_object('minimumQuantity',e."minimumQuantity"::text,'targetQuantity',e."targetQuantity"::text,'createdAt',to_char(e."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 RETURN NEW;
END $$;
CREATE TRIGGER apply_reorder_request BEFORE INSERT OR UPDATE OR DELETE ON "InventoryReorderRequest" FOR EACH ROW EXECUTE FUNCTION erp_apply_reorder_request();
CREATE FUNCTION erp_audit_reorder_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'inventory-reorder.'||lower(NEW.outcome),'InventoryReorderRequest',NEW.id::text,jsonb_build_object('outcome',NEW.outcome),NEW."createdAt");
 RETURN NEW;
END $$;
CREATE TRIGGER audit_reorder_request AFTER INSERT ON "InventoryReorderRequest" FOR EACH ROW EXECUTE FUNCTION erp_audit_reorder_request();
CREATE FUNCTION erp_guard_reorder_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity IN ('InventoryReorderPolicy','InventoryReorderRevision','InventoryReorderRequest') THEN RAISE EXCEPTION 'Reorder audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity IN ('InventoryReorderPolicy','InventoryReorderRevision','InventoryReorderRequest') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Reorder audit is request-generated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_reorder_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_reorder_audit();
CREATE FUNCTION erp_guard_reorder_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Durable reorder history cannot be truncated' USING ERRCODE='23514'; END $$;
CREATE TRIGGER guard_reorder_policy_truncate BEFORE TRUNCATE ON "InventoryReorderPolicy" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_reorder_truncate();
CREATE TRIGGER guard_reorder_revision_truncate BEFORE TRUNCATE ON "InventoryReorderRevision" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_reorder_truncate();
CREATE TRIGGER guard_reorder_request_truncate BEFORE TRUNCATE ON "InventoryReorderRequest" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_reorder_truncate();
ALTER TABLE "InventoryReorderPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReorderRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReorderRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "InventoryReorderPolicy","InventoryReorderRevision","InventoryReorderRequest" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_guard_reorder_item_unit(),erp_guard_reorder_projection(),erp_apply_reorder_request(),erp_audit_reorder_request(),erp_guard_reorder_audit(),erp_guard_reorder_truncate() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "InventoryReorderPolicy","InventoryReorderRevision","InventoryReorderRequest" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_guard_reorder_item_unit(),erp_guard_reorder_projection(),erp_apply_reorder_request(),erp_audit_reorder_request(),erp_guard_reorder_audit(),erp_guard_reorder_truncate() FROM %I',r);
END IF; END LOOP; END $$;
COMMIT;
