BEGIN;
-- No rules or notifications are enabled or backfilled. Ticket reopening generations
-- distinguish an inactive -> active transition even between manual evaluations.
ALTER TABLE "Ticket" ADD COLUMN "alertReopenVersion" INTEGER NOT NULL DEFAULT 0 CHECK("alertReopenVersion">=0);
CREATE FUNCTION erp_alert_ticket_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW."alertReopenVersion"<>0 THEN RAISE EXCEPTION 'Initial alert generation must be zero' USING ERRCODE='23514'; END IF;
 ELSE
 IF NEW."alertReopenVersion"<>OLD."alertReopenVersion" THEN RAISE EXCEPTION 'Alert generation is maintained by the database' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('RESOLVED','CLOSED') AND NEW.status IN ('OPEN','IN_PROGRESS') THEN NEW."alertReopenVersion":=OLD."alertReopenVersion"+1; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER alert_ticket_generation BEFORE INSERT OR UPDATE ON "Ticket" FOR EACH ROW EXECUTE FUNCTION erp_alert_ticket_generation();
CREATE TABLE "PrivateAlertRule" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,"actorId" UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('TICKET_DEADLINE','SUBSCRIPTION_REVIEW','STOCK_REORDER')),
 "lookbackDays" INTEGER,"horizonDays" INTEGER,priority TEXT,
 enabled BOOLEAN NOT NULL DEFAULT false,version INTEGER NOT NULL CHECK(version>0),"lastEvaluatedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(id,"tenantId","companyId","actorId"),
 CHECK(((kind='STOCK_REORDER' AND "branchId" IS NOT NULL AND "lookbackDays" IS NULL AND "horizonDays" IS NULL AND priority IS NULL) OR
 (kind IN ('TICKET_DEADLINE','SUBSCRIPTION_REVIEW') AND "lookbackDays" BETWEEN 0 AND 3660 AND "horizonDays" BETWEEN 0 AND 366 AND (kind='SUBSCRIPTION_REVIEW' AND priority IS NULL OR kind='TICKET_DEADLINE' AND priority IN ('ALL','LOW','NORMAL','HIGH','URGENT')))) IS TRUE),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX private_alert_rules_owner ON "PrivateAlertRule"("tenantId","companyId","actorId","createdAt",id);
CREATE TABLE "PrivateAlertNotice" (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"ruleId" UUID NOT NULL REFERENCES "PrivateAlertRule"(id) ON DELETE RESTRICT,
 "sourceId" UUID NOT NULL,fingerprint TEXT NOT NULL,episode INTEGER NOT NULL CHECK(episode>0),
 observation JSONB NOT NULL CHECK(jsonb_typeof(observation)='object'),"observedAt" TIMESTAMPTZ(3) NOT NULL,
 "lastMatchedAt" TIMESTAMPTZ(3) NOT NULL,"lastEvaluationMatched" BOOLEAN NOT NULL,
 "acknowledgedAt" TIMESTAMPTZ(3),UNIQUE("ruleId","sourceId",episode)
);
CREATE UNIQUE INDEX private_alert_one_active ON "PrivateAlertNotice"("ruleId","sourceId") WHERE "lastEvaluationMatched";
CREATE INDEX private_alert_notice_page ON "PrivateAlertNotice"("ruleId","observedAt",id);
CREATE TABLE "PrivateAlertRequest" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"actorId" UUID NOT NULL,"ruleId" UUID NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('create','enable','disable','evaluate','acknowledge')),
 "expectedVersion" INTEGER NOT NULL CHECK("expectedVersion" BETWEEN 0 AND 2147483646),
 request JSONB NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN ('COMMITTED','ABANDONED')),result JSONB,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX private_alert_request_owner ON "PrivateAlertRequest"("tenantId","companyId","actorId","ruleId");
CREATE FUNCTION erp_alert_rule_access(r "PrivateAlertRule") RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT erp_payment_term_actor_access(r."actorId",r."tenantId",r."companyId",r."branchId",CASE r.kind WHEN 'TICKET_DEADLINE' THEN 'ticket:read' WHEN 'SUBSCRIPTION_REVIEW' THEN 'subscription:read' ELSE 'inventory-stock:read' END)
$$;
-- This helper only decides current visibility, never reveals labels, amounts or counts.
CREATE FUNCTION erp_alert_source_visible(r "PrivateAlertRule",source UUID) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT erp_alert_rule_access(r) AND CASE r.kind
 WHEN 'TICKET_DEADLINE' THEN EXISTS(SELECT 1 FROM "Ticket" t WHERE t.id=source AND t."tenantId"=r."tenantId" AND t."companyId"=r."companyId" AND (r."branchId" IS NULL OR t."branchId"=r."branchId") AND erp_payment_term_actor_access(r."actorId",r."tenantId",r."companyId",t."branchId",'ticket:read'))
 WHEN 'SUBSCRIPTION_REVIEW' THEN EXISTS(SELECT 1 FROM "ManualSubscription" s JOIN "Customer" c ON c.id=s."customerId" AND c."tenantId"=s."tenantId" AND c."companyId"=s."companyId" WHERE s.id=source AND s."tenantId"=r."tenantId" AND s."companyId"=r."companyId" AND (r."branchId" IS NULL OR s."branchId"=r."branchId") AND erp_payment_term_actor_access(r."actorId",r."tenantId",r."companyId",s."branchId",'subscription:read') AND erp_payment_term_actor_access(r."actorId",r."tenantId",r."companyId",c."branchId",'customer:read'))
 ELSE EXISTS(SELECT 1 FROM "InventoryReorderPolicy" p JOIN "InventoryItem" i ON i.id=p."itemId" AND i."tenantId"=p."tenantId" AND i."companyId"=p."companyId" AND (i."branchId" IS NULL OR i."branchId"=p."branchId") WHERE p.id=source AND p."tenantId"=r."tenantId" AND p."companyId"=r."companyId" AND p."branchId"=r."branchId" AND erp_payment_term_actor_access(r."actorId",r."tenantId",r."companyId",p."branchId",'inventory-stock:read')) END
$$;
-- One statement supplies a coherent bounded observation. UTC date bounds are inclusive
-- for review dates; ticket instants use [UTC midnight - lookback, next midnight + horizon).
CREATE FUNCTION erp_alert_matches(r "PrivateAlertRule",at_time TIMESTAMPTZ) RETURNS TABLE("sourceId" UUID,fingerprint TEXT,observation JSONB) LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT t.id,t."deadlineSequence"::text||':'||t."alertReopenVersion"::text,jsonb_build_object('label',t.subject,'reference',t.number,'dueAt',t."resolutionDueAt",'priority',t.priority)
 FROM "Ticket" t WHERE r.kind='TICKET_DEADLINE' AND t."tenantId"=r."tenantId" AND t."companyId"=r."companyId" AND (r."branchId" IS NULL OR t."branchId"=r."branchId") AND t.status IN ('OPEN','IN_PROGRESS') AND (r.priority='ALL' OR t.priority::text=r.priority)
 AND t."resolutionDueAt">=((at_time AT TIME ZONE 'UTC')::date-r."lookbackDays")::timestamp AT TIME ZONE 'UTC'
 AND t."resolutionDueAt"<((at_time AT TIME ZONE 'UTC')::date+r."horizonDays"+1)::timestamp AT TIME ZONE 'UTC'
 AND erp_alert_source_visible(r,t.id)
 UNION ALL
 SELECT s.id,s.version::text,jsonb_build_object('label',s."serviceLabel",'reference',s.reference,'reviewDate',s."nextReviewDate")
 FROM "ManualSubscription" s WHERE r.kind='SUBSCRIPTION_REVIEW' AND s."tenantId"=r."tenantId" AND s."companyId"=r."companyId" AND (r."branchId" IS NULL OR s."branchId"=r."branchId") AND NOT s.archived AND s.status='ACTIVE'
 AND s."nextReviewDate" BETWEEN (at_time AT TIME ZONE 'UTC')::date-r."lookbackDays" AND (at_time AT TIME ZONE 'UTC')::date+r."horizonDays" AND erp_alert_source_visible(r,s.id)
 UNION ALL
 SELECT p.id,p.version::text,jsonb_build_object('label',p."itemName",'reference',p.reference,'unit',p.unit,'minimumQuantity',p."minimumQuantity"::text,'availableQuantity',(COALESCE(b.quantity,0)-COALESCE(b."reservedQuantity",0))::text,'targetQuantity',p."targetQuantity"::text)
 FROM "InventoryReorderPolicy" p JOIN "InventoryItem" i ON i.id=p."itemId" LEFT JOIN "StockBalance" b ON b."tenantId"=p."tenantId" AND b."companyId"=p."companyId" AND b."branchId"=p."branchId" AND b."itemId"=p."itemId"
 WHERE r.kind='STOCK_REORDER' AND p."tenantId"=r."tenantId" AND p."companyId"=r."companyId" AND p."branchId"=r."branchId" AND NOT p.archived AND i."archivedAt" IS NULL AND i.unit=p.unit AND i."reorderUnitVersion"=p."unitVersion" AND COALESCE(b.quantity,0)-COALESCE(b."reservedQuantity",0)<p."minimumQuantity" AND erp_alert_source_visible(r,p.id)
 LIMIT 1001
$$;
CREATE FUNCTION erp_alert_guard_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Private alerts are request-generated' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='PrivateAlertRule' AND TG_OP='UPDATE' THEN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."actorId",NEW.kind,NEW."lookbackDays",NEW."horizonDays",NEW.priority,NEW."createdAt") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."actorId",OLD.kind,OLD."lookbackDays",OLD."horizonDays",OLD.priority,OLD."createdAt") THEN RAISE EXCEPTION 'Alert configuration is immutable; create a new rule' USING ERRCODE='23514'; END IF; END IF;
 IF TG_TABLE_NAME='PrivateAlertNotice' AND TG_OP='UPDATE' THEN
 IF (NEW.id,NEW."ruleId",NEW."sourceId",NEW.fingerprint,NEW.episode,NEW.observation,NEW."observedAt") IS DISTINCT FROM (OLD.id,OLD."ruleId",OLD."sourceId",OLD.fingerprint,OLD.episode,OLD.observation,OLD."observedAt") THEN RAISE EXCEPTION 'Alert observations are immutable' USING ERRCODE='23514'; END IF; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER private_alert_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON "PrivateAlertRule" FOR EACH ROW EXECUTE FUNCTION erp_alert_guard_projection();
CREATE TRIGGER private_alert_notice_guard BEFORE INSERT OR UPDATE OR DELETE ON "PrivateAlertNotice" FOR EACH ROW EXECUTE FUNCTION erp_alert_guard_projection();
CREATE FUNCTION erp_apply_alert_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r "PrivateAlertRule"%ROWTYPE;p JSONB;config JSONB;expected JSONB;matches JSONB;item JSONB;now_time TIMESTAMPTZ;next_episode INTEGER;notice_id UUID;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Private alert requests are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Alert writes require READ COMMITTED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('private-alert-request:'||NEW.id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('private-alert-rule:'||NEW."ruleId"::text,0));
 SELECT * INTO r FROM "PrivateAlertRule" WHERE id=NEW."ruleId" FOR UPDATE;
 p:=NEW.request; config:=p->'config';
 expected:=jsonb_build_object('requestId',NEW.id,'tenantId',NEW."tenantId",'companyId',NEW."companyId",'expectedActorId',NEW."actorId",'ruleId',NEW."ruleId",'action',NEW.action,'expectedVersion',NEW."expectedVersion",'config',config,'noticeId',p->'noticeId');
 IF p IS DISTINCT FROM expected OR NEW.id=NEW."ruleId" OR (NEW.action='create') IS DISTINCT FROM (NEW."expectedVersion"=0) OR (NEW.action='acknowledge') IS DISTINCT FROM (jsonb_typeof(p->'noticeId')='string') OR (NEW.action<>'acknowledge' AND p->'noticeId'<>'null'::jsonb) THEN RAISE EXCEPTION 'Exact private alert request required' USING ERRCODE='23514'; END IF;
 IF NEW.action='create' THEN
 IF r.id IS NOT NULL OR config IS DISTINCT FROM jsonb_build_object('branchId',config->'branchId','kind',config->'kind','lookbackDays',config->'lookbackDays','horizonDays',config->'horizonDays','priority',config->'priority') OR jsonb_typeof(config->'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Invalid alert configuration' USING ERRCODE='23514'; END IF;
 r.id:=NEW."ruleId";r."tenantId":=NEW."tenantId";r."companyId":=NEW."companyId";r."actorId":=NEW."actorId";r."branchId":=(config->>'branchId')::uuid;r.kind:=config->>'kind';r."lookbackDays":=(config->>'lookbackDays')::integer;r."horizonDays":=(config->>'horizonDays')::integer;r.priority:=config->>'priority';
 IF config IS DISTINCT FROM jsonb_build_object('kind',r.kind,'branchId',r."branchId",'lookbackDays',r."lookbackDays",'horizonDays',r."horizonDays",'priority',r.priority) THEN RAISE EXCEPTION 'Typed alert configuration required' USING ERRCODE='23514'; END IF;

 IF ((r.kind='STOCK_REORDER' AND r."branchId" IS NOT NULL AND r."lookbackDays" IS NULL AND r."horizonDays" IS NULL AND r.priority IS NULL) OR (r.kind IN ('TICKET_DEADLINE','SUBSCRIPTION_REVIEW') AND r."lookbackDays" BETWEEN 0 AND 3660 AND r."horizonDays" BETWEEN 0 AND 366 AND (r.kind='SUBSCRIPTION_REVIEW' AND r.priority IS NULL OR r.kind='TICKET_DEADLINE' AND r.priority IN ('ALL','LOW','NORMAL','HIGH','URGENT')))) IS NOT TRUE THEN RAISE EXCEPTION 'Explicit bounded alert configuration required' USING ERRCODE='23514'; END IF;
 ELSE
 IF config<>'null'::jsonb OR r.id IS NULL OR (r."tenantId",r."companyId",r."actorId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."actorId") THEN RAISE EXCEPTION 'Private alert identity mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action='acknowledge' THEN notice_id:=(p->>'noticeId')::uuid; END IF;
 -- Recovery authority is deliberately weaker ONLY for an immutable tombstone.
 -- Identity/config validation and owned existing rule checks above still apply.
 -- No projections, observations, counts or source status are read or returned here.
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."actorId" AND status='ACTIVE') THEN RAISE EXCEPTION 'Current active membership required' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp();NEW.result:=NULL;
 IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
 IF NOT erp_alert_rule_access(r) THEN RAISE EXCEPTION 'Current source scope access required' USING ERRCODE='23514'; END IF;
 IF NEW.action<>'create' AND r.version<>NEW."expectedVersion" THEN RAISE EXCEPTION 'Stale alert rule version' USING ERRCODE='23514'; END IF;
 IF NEW.action='create' THEN
 INSERT INTO "PrivateAlertRule"(id,"tenantId","companyId","branchId","actorId",kind,"lookbackDays","horizonDays",priority,enabled,version) VALUES(r.id,r."tenantId",r."companyId",r."branchId",r."actorId",r.kind,r."lookbackDays",r."horizonDays",r.priority,false,1);
 ELSE
 IF NEW.action='evaluate' THEN
 IF NOT r.enabled THEN RAISE EXCEPTION 'Explicitly enable the rule before evaluation' USING ERRCODE='23514'; END IF;
 now_time:=clock_timestamp();
 SELECT COALESCE(jsonb_agg(to_jsonb(m)),'[]'::jsonb) INTO matches FROM erp_alert_matches(r,now_time) m;
 IF jsonb_array_length(matches)>1000 THEN RAISE EXCEPTION 'Evaluation exceeds 1000 matching sources; narrow the rule scope or date bounds. No observations changed.' USING ERRCODE='23514'; END IF;
 -- Absence only resolves an observation when its source is still currently visible.
 -- A revoked/moved/deleted source is retained as unknown, never labelled resolved.
 UPDATE "PrivateAlertNotice" n SET "lastEvaluationMatched"=false WHERE n."ruleId"=r.id AND n."lastEvaluationMatched" AND erp_alert_source_visible(r,n."sourceId") AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(matches) m WHERE (m->>'sourceId')::uuid=n."sourceId" AND m->>'fingerprint'=n.fingerprint);
 FOR item IN SELECT value FROM jsonb_array_elements(matches) LOOP
 UPDATE "PrivateAlertNotice" SET "lastMatchedAt"=now_time WHERE "ruleId"=r.id AND "sourceId"=(item->>'sourceId')::uuid AND "lastEvaluationMatched" AND fingerprint=item->>'fingerprint';
 IF NOT FOUND THEN
 SELECT COALESCE(max(episode),0)+1 INTO next_episode FROM "PrivateAlertNotice" WHERE "ruleId"=r.id AND "sourceId"=(item->>'sourceId')::uuid;
 INSERT INTO "PrivateAlertNotice"("ruleId","sourceId",fingerprint,episode,observation,"observedAt","lastMatchedAt","lastEvaluationMatched") VALUES(r.id,(item->>'sourceId')::uuid,item->>'fingerprint',next_episode,item->'observation',now_time,now_time,true);
 END IF; END LOOP;
 ELSIF NEW.action='acknowledge' THEN
 notice_id:=(p->>'noticeId')::uuid;
 UPDATE "PrivateAlertNotice" n SET "acknowledgedAt"=COALESCE("acknowledgedAt",NEW."createdAt") WHERE n.id=notice_id AND n."ruleId"=r.id AND erp_alert_source_visible(r,n."sourceId");
 IF NOT FOUND THEN RAISE EXCEPTION 'Visible private notice required' USING ERRCODE='23514'; END IF;
 END IF;
 UPDATE "PrivateAlertRule" SET version=version+1,enabled=CASE NEW.action WHEN 'enable' THEN true WHEN 'disable' THEN false ELSE enabled END,"lastEvaluatedAt"=CASE NEW.action WHEN 'evaluate' THEN now_time ELSE "lastEvaluatedAt" END WHERE id=r.id;
 END IF;
 NEW.result:=jsonb_build_object('requestId',NEW.id,'ruleId',r.id,'actorId',NEW."actorId",'action',NEW.action,'version',NEW."expectedVersion"+1,'outcome','COMMITTED','request',NEW.request);
 RETURN NEW;
END $$;
CREATE TRIGGER apply_private_alert_request BEFORE INSERT OR UPDATE OR DELETE ON "PrivateAlertRequest" FOR EACH ROW EXECUTE FUNCTION erp_apply_alert_request();
CREATE FUNCTION erp_alert_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Private alert history cannot be truncated' USING ERRCODE='23514'; END $$;
CREATE TRIGGER alert_rule_no_truncate BEFORE TRUNCATE ON "PrivateAlertRule" EXECUTE FUNCTION erp_alert_no_truncate();
CREATE TRIGGER alert_notice_no_truncate BEFORE TRUNCATE ON "PrivateAlertNotice" EXECUTE FUNCTION erp_alert_no_truncate();
CREATE TRIGGER alert_request_no_truncate BEFORE TRUNCATE ON "PrivateAlertRequest" EXECUTE FUNCTION erp_alert_no_truncate();
ALTER TABLE "PrivateAlertRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateAlertNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivateAlertRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PrivateAlertRule","PrivateAlertNotice","PrivateAlertRequest" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_alert_ticket_generation(),erp_alert_rule_access("PrivateAlertRule"),erp_alert_source_visible("PrivateAlertRule",UUID),erp_alert_matches("PrivateAlertRule",TIMESTAMPTZ),erp_alert_guard_projection(),erp_apply_alert_request(),erp_alert_no_truncate() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
 EXECUTE format('REVOKE ALL ON "PrivateAlertRule","PrivateAlertNotice","PrivateAlertRequest" FROM %I',role_name);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_alert_ticket_generation(),erp_alert_rule_access("PrivateAlertRule"),erp_alert_source_visible("PrivateAlertRule",UUID),erp_alert_matches("PrivateAlertRule",TIMESTAMPTZ),erp_alert_guard_projection(),erp_apply_alert_request(),erp_alert_no_truncate() FROM %I',role_name);
 END IF;END LOOP;END $$;
COMMIT;
