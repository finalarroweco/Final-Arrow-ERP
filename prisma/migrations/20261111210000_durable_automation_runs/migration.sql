BEGIN;
-- No jobs, credentials, schedules, or enabled runners are created.
INSERT INTO "Permission"(key) VALUES('automation:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'automation:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;
CREATE TABLE "AutomationJob"(
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,"actorId" UUID NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('RECURRING_DRAFT','PRIVATE_ALERT')),"sourceId" UUID NOT NULL,config JSONB NOT NULL,
 "authorizedFingerprint" TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('PAUSED','ENABLED','CANCELLED','COMPLETED')),
 version INTEGER NOT NULL CHECK(version>0),"nextDueAt" TIMESTAMPTZ(3) NOT NULL,"runsUsed" INTEGER NOT NULL DEFAULT 0 CHECK("runsUsed" BETWEEN 0 AND 100),cursor INTEGER,
 "lastCode" TEXT NOT NULL DEFAULT 'CONFIGURED',"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id),
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id),
 FOREIGN KEY("tenantId","actorId") REFERENCES "Membership"("tenantId","userId")
);
CREATE INDEX automation_due ON "AutomationJob"(state,"nextDueAt",id);
CREATE INDEX automation_owner ON "AutomationJob"("actorId","tenantId","companyId","branchId",id);
CREATE TABLE "AutomationRun"(
 id UUID PRIMARY KEY,"jobId" UUID NOT NULL REFERENCES "AutomationJob"(id),sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 100),
 state TEXT NOT NULL CHECK(state IN('READY','LEASED','RETRY','SUCCEEDED','SKIPPED','CANCELLED','UNKNOWN')),
 "downstreamId" UUID NOT NULL UNIQUE,payload JSONB,"scheduledAt" TIMESTAMPTZ(3) NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),fence INTEGER NOT NULL DEFAULT 0 CHECK(fence>=0),"leaseToken" UUID,"leaseUntil" TIMESTAMPTZ(3),"nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
 code TEXT NOT NULL DEFAULT 'QUEUED',"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"finishedAt" TIMESTAMPTZ(3),UNIQUE("jobId",sequence)
);
CREATE UNIQUE INDEX automation_one_pending ON "AutomationRun"("jobId") WHERE state IN('READY','LEASED','RETRY');
CREATE TABLE "AutomationEvent"(
 id UUID PRIMARY KEY,"jobId" UUID NOT NULL,"actorId" UUID NOT NULL,operation TEXT NOT NULL CHECK(operation IN('COMMAND','CLAIM','PREPARE','FINISH','ERROR')),
 data JSONB NOT NULL,result JSONB,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX automation_events ON "AutomationEvent"("jobId","createdAt",id);
CREATE FUNCTION erp_automation_access(j "AutomationJob") RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",j."branchId",'automation:manage') AND CASE j.kind
 WHEN 'RECURRING_DRAFT' THEN EXISTS(
 SELECT 1 FROM "BillingSubscription" s JOIN "Customer" c ON c.id=s."customerId" JOIN "BillingSubscriptionRevision" r ON r."subscriptionId"=s.id JOIN "BillingPlanRevision" pr ON pr.id=r."planRevisionId" JOIN "BillingPlan" p ON p.id=pr."planId"
 WHERE s.id=j."sourceId" AND s."tenantId"=j."tenantId" AND s."companyId"=j."companyId" AND s."branchId" IS NOT DISTINCT FROM j."branchId" AND r.version=s.version
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",j."branchId",'billing-subscription:read')
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",j."branchId",'billing-subscription:generate')
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",j."branchId",'invoice:read')
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",j."branchId",'invoice:create')
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",c."branchId",'customer:read')
 AND erp_payment_term_actor_access(j."actorId",j."tenantId",j."companyId",p."branchId",'billing-subscription:read'))
 ELSE EXISTS(SELECT 1 FROM "PrivateAlertRule" r WHERE r.id=j."sourceId" AND r."actorId"=j."actorId" AND r."tenantId"=j."tenantId" AND r."companyId"=j."companyId" AND r."branchId" IS NOT DISTINCT FROM j."branchId" AND erp_alert_rule_access(r)) END
$$;
CREATE FUNCTION erp_automation_fingerprint(j "AutomationJob") RETURNS TEXT LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE j.kind WHEN 'RECURRING_DRAFT' THEN (
 SELECT md5(jsonb_build_array(to_jsonb(s),to_jsonb(r),to_jsonb(pr),to_jsonb(p),to_jsonb(v),c."branchId",c."archivedAt",co."baseCurrency")::text)
 FROM "BillingSubscription" s JOIN "BillingSubscriptionRevision" r ON r."subscriptionId"=s.id AND r.version=s.version
 JOIN "BillingPlanRevision" pr ON pr.id=r."planRevisionId" JOIN "BillingPlan" p ON p.id=pr."planId" JOIN "Customer" c ON c.id=s."customerId" JOIN "Company" co ON co.id=s."companyId" LEFT JOIN "CompanyVatProfile" v ON v."companyId"=s."companyId"
 WHERE s.id=j."sourceId" AND co."baseCurrency"=s.currency AND pr.currency=s.currency AND (c."branchId" IS NULL OR c."branchId" IS NOT DISTINCT FROM j."branchId") AND (p."branchId" IS NULL OR p."branchId" IS NOT DISTINCT FROM j."branchId") AND NOT s.archived AND NOT r.archived AND r.status='ACTIVE' AND NOT p.archived AND NOT pr.archived AND c."archivedAt" IS NULL)
 ELSE (SELECT md5((to_jsonb(r)-'lastEvaluatedAt')::text) FROM "PrivateAlertRule" r WHERE r.id=j."sourceId" AND r.enabled) END
$$;
CREATE FUNCTION erp_automation_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='TRUNCATE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Automation projections require an immutable event' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Automation history cannot be deleted' USING ERRCODE='23514';END IF; RETURN NEW;
END;$$;
CREATE TRIGGER automation_job_guard BEFORE INSERT OR UPDATE OR DELETE ON "AutomationJob" FOR EACH ROW EXECUTE FUNCTION erp_automation_projection_guard();
CREATE TRIGGER automation_run_guard BEFORE INSERT OR UPDATE OR DELETE ON "AutomationRun" FOR EACH ROW EXECUTE FUNCTION erp_automation_projection_guard();
CREATE TRIGGER automation_job_truncate BEFORE TRUNCATE ON "AutomationJob" FOR EACH STATEMENT EXECUTE FUNCTION erp_automation_projection_guard();
CREATE TRIGGER automation_run_truncate BEFORE TRUNCATE ON "AutomationRun" FOR EACH STATEMENT EXECUTE FUNCTION erp_automation_projection_guard();
CREATE FUNCTION erp_automation_apply() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j "AutomationJob";r "AutomationRun";c JSONB;cfg JSONB;act TEXT;now_time TIMESTAMPTZ:=clock_timestamp();fp TEXT;step INTERVAL;next_time TIMESTAMPTZ;is_member BOOLEAN;payload JSONB;terminal TEXT;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Automation requires current read committed authority' USING ERRCODE='23514';END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Automation events are immutable' USING ERRCODE='23514';END IF;
 NEW."createdAt"=clock_timestamp();
 IF NEW.result IS NOT NULL OR jsonb_typeof(NEW.data) IS DISTINCT FROM 'object' OR octet_length(NEW.data::text)>16384 THEN RAISE EXCEPTION 'Invalid automation event' USING ERRCODE='23514';END IF;
 -- Global order: tenant, job, company, downstream source/request.
 IF NEW.operation='COMMAND' THEN
  PERFORM id FROM "Tenant" WHERE id=(NEW.data->'request'->>'tenantId')::uuid FOR SHARE;
 ELSE
  PERFORM t.id FROM "Tenant" t JOIN "AutomationJob" a ON a."tenantId"=t.id WHERE a.id=NEW."jobId" FOR SHARE OF t;
 END IF;
 IF NEW.operation='COMMAND' AND NEW.data->'request'->>'action'='create' THEN PERFORM pg_advisory_xact_lock(hashtextextended('automation-job:'||NEW."jobId"::text,0));END IF;
 SELECT * INTO j FROM "AutomationJob" WHERE id=NEW."jobId" FOR UPDATE;
 IF NEW.operation='COMMAND' THEN
  c=NEW.data->'request';act=c->>'action';cfg=c->'config';
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>9 OR NOT c ?& ARRAY['tenantId','companyId','branchId','expectedActorId','requestId','jobId','action','expectedVersion','config'] OR (c->>'requestId')::uuid<>NEW.id OR (c->>'jobId')::uuid<>NEW."jobId" OR (c->>'expectedActorId')::uuid<>NEW."actorId" OR NEW.id=NEW."jobId" OR act NOT IN('create','enable','pause','cancel','run') OR c->>'expectedVersion' !~ '^[0-9]+$' OR NEW.data->>'outcome' NOT IN('COMMITTED','ABANDONED') THEN RAISE EXCEPTION 'Invalid command identity' USING ERRCODE='23514';END IF;
  IF NOT COALESCE(jsonb_typeof(c->'tenantId')='string' AND jsonb_typeof(c->'companyId')='string' AND jsonb_typeof(c->'expectedActorId')='string' AND jsonb_typeof(c->'requestId')='string' AND jsonb_typeof(c->'jobId')='string' AND jsonb_typeof(c->'action')='string' AND jsonb_typeof(c->'expectedVersion')='number' AND jsonb_typeof(c->'branchId') IN('string','null') AND NEW.data->>'outcome' IN('COMMITTED','ABANDONED'),false) THEN RAISE EXCEPTION 'Explicit command fields required' USING ERRCODE='23514';END IF;
  PERFORM id FROM "Tenant" WHERE id=(c->>'tenantId')::uuid FOR SHARE;
  SELECT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=(c->>'tenantId')::uuid AND "userId"=NEW."actorId" AND status='ACTIVE') INTO is_member;
  IF NOT is_member THEN RAISE EXCEPTION 'Active membership required' USING ERRCODE='23514';END IF;
  IF j.id IS NOT NULL AND (j."actorId"<>NEW."actorId" OR j."tenantId"<>(c->>'tenantId')::uuid OR j."companyId"<>(c->>'companyId')::uuid OR j."branchId" IS DISTINCT FROM (c->>'branchId')::uuid) THEN RAISE EXCEPTION 'Job owner and scope mismatch' USING ERRCODE='23514';END IF;
  IF NEW.data->>'outcome'='ABANDONED' THEN NEW.result=jsonb_build_object('requestId',NEW.id,'jobId',NEW."jobId",'actorId',NEW."actorId",'outcome','ABANDONED','request',c);RETURN NEW;END IF;
  IF NOT COALESCE((c->>'expectedVersion')::bigint BETWEEN 0 AND 2147483646,false) THEN RAISE EXCEPTION 'Explicit bounded version required' USING ERRCODE='23514';END IF;
  IF act='create' THEN
   IF j.id IS NOT NULL OR (c->>'expectedVersion')::integer<>0 OR jsonb_typeof(cfg) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(cfg))<>9 OR NOT cfg ?& ARRAY['kind','sourceId','firstPeriod','lastPeriod','startsAt','endsAt','intervalHours','maxRuns','sourceFingerprint'] OR cfg->>'kind' NOT IN('RECURRING_DRAFT','PRIVATE_ALERT') OR cfg->>'intervalHours' !~ '^[0-9]+$' OR (cfg->>'intervalHours')::integer NOT BETWEEN 1 AND 168 OR cfg->>'maxRuns' !~ '^[0-9]+$' OR (cfg->>'maxRuns')::integer NOT BETWEEN 1 AND 100 OR cfg->>'sourceFingerprint' !~ '^[a-f0-9]{32}$' OR cfg->>'startsAt' !~ 'Z$' OR cfg->>'endsAt' !~ 'Z$' OR (cfg->>'endsAt')::timestamptz<=(cfg->>'startsAt')::timestamptz OR (cfg->>'endsAt')::timestamptz>(cfg->>'startsAt')::timestamptz+INTERVAL '366 days' OR (cfg->>'endsAt')::timestamptz<=now_time THEN RAISE EXCEPTION 'Finite explicit configuration required' USING ERRCODE='23514';END IF;
   IF NOT COALESCE(jsonb_typeof(cfg->'kind')='string' AND jsonb_typeof(cfg->'sourceId')='string' AND jsonb_typeof(cfg->'startsAt')='string' AND jsonb_typeof(cfg->'endsAt')='string' AND jsonb_typeof(cfg->'intervalHours')='number' AND jsonb_typeof(cfg->'maxRuns')='number' AND jsonb_typeof(cfg->'sourceFingerprint')='string',false) THEN RAISE EXCEPTION 'Non-null typed configuration required' USING ERRCODE='23514';END IF;
   IF cfg->>'kind'='RECURRING_DRAFT' THEN
    IF cfg->>'firstPeriod' IS NULL OR cfg->>'lastPeriod' IS NULL OR cfg->>'firstPeriod' !~ '^[0-9]+$' OR cfg->>'lastPeriod' !~ '^[0-9]+$' OR (cfg->>'firstPeriod')::integer NOT BETWEEN 0 AND 100000 OR (cfg->>'lastPeriod')::integer<(cfg->>'firstPeriod')::integer OR (cfg->>'lastPeriod')::integer>100000 OR (cfg->>'lastPeriod')::integer>(cfg->>'firstPeriod')::integer+23 THEN RAISE EXCEPTION 'One to 24 explicit billing periods required' USING ERRCODE='23514';END IF;
   ELSIF cfg->'firstPeriod'<>'null'::jsonb OR cfg->'lastPeriod'<>'null'::jsonb THEN RAISE EXCEPTION 'Alert periods must be null' USING ERRCODE='23514';END IF;
   j.id=NEW."jobId";j."tenantId"=(c->>'tenantId')::uuid;j."companyId"=(c->>'companyId')::uuid;j."branchId"=(c->>'branchId')::uuid;j."actorId"=NEW."actorId";j.kind=cfg->>'kind';j."sourceId"=(cfg->>'sourceId')::uuid;
   IF NOT erp_automation_access(j) OR erp_automation_fingerprint(j) IS DISTINCT FROM cfg->>'sourceFingerprint' THEN RAISE EXCEPTION 'Current source authorization and fingerprint required' USING ERRCODE='23514';END IF;
   IF j.kind='RECURRING_DRAFT' AND NOT EXISTS(SELECT 1 FROM "BillingSubscription" sub JOIN "BillingSubscriptionRevision" rev ON rev."subscriptionId"=sub.id AND rev.version=sub.version WHERE sub.id=j."sourceId" AND (cfg->>'firstPeriod')::integer>=rev."effectivePeriod" AND erp_billing_boundary(sub.anchor,sub.cadence,(cfg->>'lastPeriod')::integer+1)<=rev.horizon) THEN RAISE EXCEPTION 'Selected periods must use the explicitly reviewed current configuration and full horizon' USING ERRCODE='23514';END IF;
   INSERT INTO "AutomationJob"(id,"tenantId","companyId","branchId","actorId",kind,"sourceId",config,"authorizedFingerprint",state,version,"nextDueAt",cursor) VALUES(j.id,j."tenantId",j."companyId",j."branchId",j."actorId",j.kind,j."sourceId",cfg,cfg->>'sourceFingerprint','PAUSED',1,(cfg->>'startsAt')::timestamptz,(cfg->>'firstPeriod')::integer);
  ELSE
   IF j.id IS NULL OR j.version<>(c->>'expectedVersion')::integer OR cfg<>'null'::jsonb OR j.state IN('CANCELLED','COMPLETED') THEN RAISE EXCEPTION 'Current mutable job version required' USING ERRCODE='23514';END IF;
   IF act IN('enable','run') AND EXISTS(SELECT 1 FROM "AutomationRun" WHERE "jobId"=j.id AND state='UNKNOWN') THEN RAISE EXCEPTION 'Unknown run requires review and cancel; never silently replace its identity' USING ERRCODE='23514';END IF;
   IF act IN('enable','run') AND (NOT erp_automation_access(j) OR erp_automation_fingerprint(j) IS DISTINCT FROM j."authorizedFingerprint" OR (j.config->>'endsAt')::timestamptz<=now_time OR j."runsUsed">=(j.config->>'maxRuns')::integer) THEN RAISE EXCEPTION 'Job authorization, configuration or budget changed' USING ERRCODE='23514';END IF;
   IF act='run' THEN
    IF j.state<>'ENABLED' OR j."nextDueAt">now_time THEN RAISE EXCEPTION 'Manual run must be enabled and due' USING ERRCODE='23514';END IF;
    -- Queueing is explicit; the protected runner still owns claiming/execution.
    UPDATE "AutomationJob" SET version=version+1,"lastCode"='QUEUED' WHERE id=j.id;
   ELSE
    UPDATE "AutomationJob" SET state=CASE act WHEN 'enable' THEN 'ENABLED' WHEN 'pause' THEN 'PAUSED' ELSE 'CANCELLED' END,version=version+1,"lastCode"=upper(act) WHERE id=j.id;
    IF act='cancel' THEN UPDATE "AutomationRun" SET state='CANCELLED',code='CANCELLED',"leaseToken"=NULL,"leaseUntil"=NULL,"finishedAt"=now_time WHERE "jobId"=j.id AND state IN('READY','LEASED','RETRY','UNKNOWN');END IF;
   END IF;
  END IF;
  NEW.result=jsonb_build_object('requestId',NEW.id,'jobId',NEW."jobId",'actorId',NEW."actorId",'outcome','COMMITTED','request',c);RETURN NEW;
 END IF;
 IF j.id IS NULL OR j."actorId"<>NEW."actorId" THEN RAISE EXCEPTION 'Unknown automation owner' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=j."tenantId" FOR SHARE;
 IF NEW.operation='CLAIM' THEN
  IF NOT COALESCE(jsonb_typeof(NEW.data->'runId')='string' AND jsonb_typeof(NEW.data->'downstreamId')='string' AND jsonb_typeof(NEW.data->'token')='string',false) THEN RAISE EXCEPTION 'Claim identities required' USING ERRCODE='23514';END IF;
  IF j.state<>'ENABLED' THEN NEW.result='{"claimed":false}'::jsonb;RETURN NEW;END IF;
  IF NOT erp_automation_access(j) OR erp_automation_fingerprint(j) IS DISTINCT FROM j."authorizedFingerprint" THEN
   UPDATE "AutomationJob" SET state='PAUSED',version=version+1,"lastCode"='REAUTHORIZE' WHERE id=j.id;NEW.result='{"claimed":false}'::jsonb;RETURN NEW;
  END IF;
  SELECT * INTO r FROM "AutomationRun" WHERE "jobId"=j.id AND state IN('READY','LEASED','RETRY') FOR UPDATE;
  IF r.id IS NOT NULL AND (r."nextAttemptAt">now_time OR r.state='LEASED' AND r."leaseUntil">now_time) THEN NEW.result='{"claimed":false}'::jsonb;RETURN NEW;END IF;
  IF now_time>=(j.config->>'endsAt')::timestamptz THEN
   UPDATE "AutomationRun" SET state='CANCELLED',code='HORIZON_ENDED',"leaseToken"=NULL,"leaseUntil"=NULL,"finishedAt"=now_time WHERE "jobId"=j.id AND state IN('READY','LEASED','RETRY');
   UPDATE "AutomationJob" SET state='COMPLETED',version=version+1,"lastCode"='HORIZON_ENDED' WHERE id=j.id;NEW.result='{"claimed":false}'::jsonb;RETURN NEW;
  END IF;
  IF r.id IS NOT NULL AND r.attempts>=3 THEN
   UPDATE "AutomationRun" SET state='UNKNOWN',code='ATTEMPTS_EXHAUSTED',"leaseToken"=NULL,"leaseUntil"=NULL,"finishedAt"=now_time WHERE id=r.id;
   UPDATE "AutomationJob" SET state='PAUSED',version=version+1,"lastCode"='ATTEMPTS_EXHAUSTED' WHERE id=j.id;NEW.result='{"claimed":false}'::jsonb;RETURN NEW;
  END IF;
  IF r.id IS NULL THEN
   IF j."nextDueAt">now_time THEN NEW.result='{"claimed":false}'::jsonb;RETURN NEW;END IF;
   IF now_time>=(j.config->>'endsAt')::timestamptz OR j."runsUsed">=(j.config->>'maxRuns')::integer OR j.kind='RECURRING_DRAFT' AND j.cursor>(j.config->>'lastPeriod')::integer THEN UPDATE "AutomationJob" SET state='COMPLETED',version=version+1,"lastCode"='BUDGET_ENDED' WHERE id=j.id;NEW.result='{"claimed":false}'::jsonb;RETURN NEW;END IF;
   IF EXISTS(SELECT 1 FROM "AutomationRun" WHERE "jobId"=j.id AND state='UNKNOWN') THEN NEW.result='{"claimed":false}'::jsonb;RETURN NEW;END IF;
   INSERT INTO "AutomationRun"(id,"jobId",sequence,state,"downstreamId","scheduledAt","nextAttemptAt") VALUES((NEW.data->>'runId')::uuid,j.id,j."runsUsed"+1,'READY',(NEW.data->>'downstreamId')::uuid,j."nextDueAt",now_time) RETURNING * INTO r;
   step=make_interval(hours=>(j.config->>'intervalHours')::integer);
   -- Coalesce missed ticks. Never create an unbounded historical queue.
   next_time=(j.config->>'startsAt')::timestamptz+(floor(extract(epoch FROM (now_time-(j.config->>'startsAt')::timestamptz))/extract(epoch FROM step))+1)*step;
   UPDATE "AutomationJob" SET "runsUsed"="runsUsed"+1,"nextDueAt"=next_time,version=version+1 WHERE id=j.id;
  END IF;
  UPDATE "AutomationRun" SET state='LEASED',attempts=attempts+1,fence=fence+1,"leaseToken"=(NEW.data->>'token')::uuid,"leaseUntil"=now_time+INTERVAL '90 seconds',code='CLAIMED' WHERE id=r.id RETURNING * INTO r;
  NEW.result=jsonb_build_object('claimed',true,'runId',r.id,'jobId',j.id,'token',r."leaseToken",'fence',r.fence);RETURN NEW;
 END IF;
 SELECT * INTO r FROM "AutomationRun" WHERE id=(NEW.data->>'runId')::uuid AND "jobId"=j.id FOR UPDATE;
 IF NOT COALESCE(jsonb_typeof(NEW.data->'runId')='string' AND jsonb_typeof(NEW.data->'token')='string' AND jsonb_typeof(NEW.data->'fence')='number' AND NEW.data->>'fence' ~ '^[0-9]+$',false) THEN RAISE EXCEPTION 'Explicit lease fence required' USING ERRCODE='23514';END IF;
 IF j.state<>'ENABLED' OR r.id IS NULL OR r.state<>'LEASED' OR r."leaseToken" IS DISTINCT FROM (NEW.data->>'token')::uuid OR r.fence<>(NEW.data->>'fence')::integer OR r."leaseUntil"<=clock_timestamp() THEN RAISE EXCEPTION 'Expired or superseded automation lease' USING ERRCODE='23514';END IF;
 IF NEW.operation='ERROR' THEN
  UPDATE "AutomationRun" SET state=CASE WHEN attempts>=3 THEN 'UNKNOWN' ELSE 'RETRY' END,code='RETRY_REQUIRED',"leaseToken"=NULL,"leaseUntil"=NULL,"nextAttemptAt"=now_time+make_interval(secs=>30*(2^attempts)::integer),"finishedAt"=CASE WHEN attempts>=3 THEN now_time END WHERE id=r.id;
  IF r.attempts>=3 THEN UPDATE "AutomationJob" SET state='PAUSED',version=version+1,"lastCode"='ATTEMPTS_EXHAUSTED' WHERE id=j.id;END IF;
  NEW.result='{"recorded":true}'::jsonb;RETURN NEW;
 END IF;
 IF NOT erp_automation_access(j) OR (NOT(NEW.operation='FINISH' AND NEW.data->>'code'='COMMITTED' AND j.kind='PRIVATE_ALERT') AND erp_automation_fingerprint(j) IS DISTINCT FROM j."authorizedFingerprint") THEN RAISE EXCEPTION 'Current source authorization changed' USING ERRCODE='23514';END IF;
 IF clock_timestamp()>=(j.config->>'endsAt')::timestamptz THEN RAISE EXCEPTION 'Automation horizon ended' USING ERRCODE='23514';END IF;
 IF NEW.operation='PREPARE' THEN
  payload=NEW.data->'payload';
  IF NOT COALESCE(jsonb_typeof(payload->'requestId')='string' AND jsonb_typeof(payload->'expectedActorId')='string' AND jsonb_typeof(payload->'tenantId')='string' AND jsonb_typeof(payload->'companyId')='string' AND jsonb_typeof(payload->'action')='string' AND jsonb_typeof(payload->'expectedVersion')='number' AND payload->>'expectedVersion' ~ '^[0-9]+$',false) THEN RAISE EXCEPTION 'Explicit downstream fields required' USING ERRCODE='23514';END IF;
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR (payload->>'requestId')::uuid<>r."downstreamId" OR (payload->>'expectedActorId')::uuid<>j."actorId" OR (payload->>'tenantId')::uuid<>j."tenantId" OR (payload->>'companyId')::uuid<>j."companyId" THEN RAISE EXCEPTION 'Exact downstream identity required' USING ERRCODE='23514';END IF;
  IF j.kind='RECURRING_DRAFT' THEN
   IF NOT COALESCE(jsonb_typeof(payload->'subscriptionId')='string' AND jsonb_typeof(payload->'periodIndex')='number' AND payload->>'periodIndex' ~ '^[0-9]+$' AND jsonb_typeof(payload->'branchId') IN('string','null') AND payload ?& ARRAY['replacesSourceId','replacementPlanRevisionId'],false) THEN RAISE EXCEPTION 'Explicit original period required' USING ERRCODE='23514';END IF;
   IF payload->>'action'<>'generate' OR (payload->>'subscriptionId')::uuid<>j."sourceId" OR (payload->>'periodIndex')::integer<>j.cursor OR (payload->>'branchId')::uuid IS DISTINCT FROM j."branchId" OR payload->'replacesSourceId'<>'null'::jsonb OR payload->'replacementPlanRevisionId'<>'null'::jsonb THEN RAISE EXCEPTION 'Only selected original DRAFT periods are authorized' USING ERRCODE='23514';END IF;
  ELSE
   IF NOT COALESCE(jsonb_typeof(payload->'ruleId')='string' AND payload ?& ARRAY['config','noticeId'],false) THEN RAISE EXCEPTION 'Explicit rule identity required' USING ERRCODE='23514';END IF;
   IF payload->>'action'<>'evaluate' OR (payload->>'ruleId')::uuid<>j."sourceId" OR payload->'config'<>'null'::jsonb OR payload->'noticeId'<>'null'::jsonb THEN RAISE EXCEPTION 'Only own rule evaluation is authorized' USING ERRCODE='23514';END IF;
  END IF;
  IF r.payload IS NOT NULL AND r.payload<>payload THEN RAISE EXCEPTION 'Saved downstream request is immutable' USING ERRCODE='23514';END IF;
  UPDATE "AutomationRun" SET payload=NEW.data->'payload',code='PREPARED' WHERE id=r.id;NEW.result='{"prepared":true}'::jsonb;RETURN NEW;
 END IF;
 IF NEW.operation='FINISH' THEN
  terminal=NEW.data->>'code';
  IF terminal='COMMITTED' THEN
   IF r.payload IS NULL THEN RAISE EXCEPTION 'Persisted request required' USING ERRCODE='23514';END IF;
   IF j.kind='RECURRING_DRAFT' THEN
    IF NOT EXISTS(SELECT 1 FROM "BillingRequest" b WHERE b.id=r."downstreamId" AND b.request=r.payload AND b.outcome='COMMITTED' AND b."createdBy"=j."actorId") THEN RAISE EXCEPTION 'Matching source receipt required' USING ERRCODE='23514';END IF;
   ELSE
    IF NOT EXISTS(SELECT 1 FROM "PrivateAlertRule" a WHERE a.id=j."sourceId" AND a.version=(r.payload->>'expectedVersion')::integer+1 AND md5(((to_jsonb(a)-'lastEvaluatedAt')||jsonb_build_object('version',(r.payload->>'expectedVersion')::integer))::text)=j."authorizedFingerprint") THEN RAISE EXCEPTION 'Alert configuration changed during execution' USING ERRCODE='23514';END IF;
    IF NOT EXISTS(SELECT 1 FROM "PrivateAlertRequest" b WHERE b.id=r."downstreamId" AND b.request=r.payload AND b.outcome='COMMITTED' AND b."actorId"=j."actorId") THEN RAISE EXCEPTION 'Matching alert receipt required' USING ERRCODE='23514';END IF;
   END IF;
  ELSE
   IF terminal NOT IN('FUTURE','GENERATED','BACKFILL_REQUIRED') OR j.kind<>'RECURRING_DRAFT' OR r.payload IS NOT NULL AND terminal<>'GENERATED' THEN RAISE EXCEPTION 'Invalid terminal result' USING ERRCODE='23514';END IF;
   IF terminal='GENERATED' THEN
    IF NOT EXISTS(SELECT 1 FROM "ServiceInvoiceSource" src WHERE src."subscriptionId"=j."sourceId" AND src."periodIndex"=j.cursor AND src."correctionIndex"=0) OR r.payload IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "BillingRequest" b WHERE b.id=r."downstreamId" AND b.request=r.payload AND b.outcome='ABANDONED') THEN RAISE EXCEPTION 'Existing period and exact abandonment required' USING ERRCODE='23514';END IF;
   ELSE
    IF NOT EXISTS(SELECT 1 FROM "BillingSubscription" sub WHERE sub.id=j."sourceId" AND CASE terminal WHEN 'FUTURE' THEN erp_billing_boundary(sub.anchor,sub.cadence,j.cursor)>(clock_timestamp() AT TIME ZONE 'UTC')::date ELSE erp_billing_boundary(sub.anchor,sub.cadence,j.cursor+1)<=(clock_timestamp() AT TIME ZONE 'UTC')::date END) THEN RAISE EXCEPTION 'Current billing boundary does not match skip' USING ERRCODE='23514';END IF;
   END IF;
  END IF;
  UPDATE "AutomationRun" SET state=CASE terminal WHEN 'COMMITTED' THEN 'SUCCEEDED' ELSE 'SKIPPED' END,code=terminal,"leaseToken"=NULL,"leaseUntil"=NULL,"finishedAt"=clock_timestamp() WHERE id=r.id;
  UPDATE "AutomationJob" SET state=CASE WHEN "runsUsed">=(config->>'maxRuns')::integer OR kind='RECURRING_DRAFT' AND cursor>=(config->>'lastPeriod')::integer AND terminal<>'FUTURE' THEN 'COMPLETED' ELSE state END,cursor=CASE WHEN kind='RECURRING_DRAFT' AND terminal<>'FUTURE' THEN cursor+1 ELSE cursor END,"authorizedFingerprint"=CASE WHEN kind='PRIVATE_ALERT' THEN erp_automation_fingerprint(j) ELSE "authorizedFingerprint" END,"lastCode"=terminal,version=version+1 WHERE id=j.id;
  NEW.result=jsonb_build_object('finished',true,'leaseDeadline',r."leaseUntil");RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Unknown automation operation' USING ERRCODE='23514';
END;$$;
CREATE TRIGGER automation_event_apply BEFORE INSERT OR UPDATE OR DELETE ON "AutomationEvent" FOR EACH ROW EXECUTE FUNCTION erp_automation_apply();
CREATE TRIGGER automation_event_truncate BEFORE TRUNCATE ON "AutomationEvent" FOR EACH STATEMENT EXECUTE FUNCTION erp_automation_projection_guard();
-- Recheck at deferred commit validation, after source completion constraints.
CREATE FUNCTION erp_automation_commit_fence() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE j "AutomationJob";
BEGIN
 IF NEW.operation='FINISH' THEN
  SELECT * INTO j FROM "AutomationJob" WHERE id=NEW."jobId";
  IF clock_timestamp()>=(NEW.result->>'leaseDeadline')::timestamptz OR clock_timestamp()>=(j.config->>'endsAt')::timestamptz THEN RAISE EXCEPTION 'Automation lease or horizon expired before commit validation' USING ERRCODE='23514';END IF;
  IF NOT erp_automation_access(j) OR erp_automation_fingerprint(j) IS DISTINCT FROM j."authorizedFingerprint" THEN RAISE EXCEPTION 'Automation authority changed before commit validation' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END;$$;
CREATE CONSTRAINT TRIGGER automation_commit_fence AFTER INSERT ON "AutomationEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_automation_commit_fence();
DO $$ DECLARE n TEXT;role_name TEXT;f TEXT;BEGIN
 FOREACH n IN ARRAY ARRAY['AutomationJob','AutomationRun','AutomationEvent'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',n);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',n,role_name);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'erp_automation_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,role_name);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
