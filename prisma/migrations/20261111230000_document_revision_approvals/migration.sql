BEGIN;
-- Optional exact-revision reviews. No policy, request, or source enrollment is created.
INSERT INTO "Permission" (key) VALUES ('document:approve') ON CONFLICT(key) DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'document:approve' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_resource_check";
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_resource_check" CHECK(resource IN('PURCHASE','EXPENSE','LEAVE','DOCUMENT'));
-- Separate retained binding avoids rewriting existing request tuples.
CREATE OR REPLACE FUNCTION erp_approval_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='TRUNCATE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Approval projections and history are command managed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' OR (TG_TABLE_NAME IN('ApprovalPolicyRevision','ApprovalDecision','DocumentApprovalSource') AND TG_OP='UPDATE') THEN RAISE EXCEPTION 'Approval history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ApprovalFinalizationPermit' AND TG_OP='UPDATE' AND ((to_jsonb(OLD)->>'consumed')::boolean OR NOT (to_jsonb(NEW)->>'consumed')::boolean OR (to_jsonb(OLD)-'consumed') IS DISTINCT FROM (to_jsonb(NEW)-'consumed')) THEN RAISE EXCEPTION 'Approval permit is single use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
CREATE TABLE "DocumentApprovalSource" (
 "approvalId" UUID PRIMARY KEY REFERENCES "ApprovalRequest"(id) ON DELETE RESTRICT,
 "eventId" UUID NOT NULL REFERENCES "InternalTextDocumentEvent"(id) ON DELETE RESTRICT
);
CREATE TRIGGER document_approval_source_guard BEFORE INSERT OR UPDATE OR DELETE ON "DocumentApprovalSource" FOR EACH ROW EXECUTE FUNCTION erp_approval_projection_guard();
CREATE TRIGGER document_approval_source_truncate BEFORE TRUNCATE ON "DocumentApprovalSource" FOR EACH STATEMENT EXECUTE FUNCTION erp_approval_projection_guard();
CREATE OR REPLACE FUNCTION erp_approval_access(u UUID,t UUID,c UUID,b UUID,r TEXT) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE r WHEN 'PURCHASE' THEN erp_payment_term_actor_access(u,t,c,b,'purchase-order:read') AND erp_payment_term_actor_access(u,t,c,b,'purchase-order:manage') WHEN 'EXPENSE' THEN erp_payment_term_actor_access(u,t,c,b,'expense:read') AND erp_payment_term_actor_access(u,t,c,b,'expense:post') WHEN 'LEAVE' THEN erp_payment_term_actor_access(u,t,c,b,'leave:read') AND erp_payment_term_actor_access(u,t,c,b,'leave:decide') WHEN 'DOCUMENT' THEN erp_payment_term_actor_access(u,t,c,b,'document:read') AND erp_payment_term_actor_access(u,t,c,b,'document:approve') ELSE false END;
$$;

CREATE OR REPLACE FUNCTION erp_approval_snapshot(t UUID,r TEXT,i UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v JSONB;
BEGIN
 IF r='PURCHASE' THEN SELECT to_jsonb(o)||jsonb_build_object('subtotal',o.subtotal::text,'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('unitPrice',l."unitPrice"::text,'amount',l.amount::text) ORDER BY l.position,l.id) FROM "PurchaseOrderLine" l WHERE l."orderId"=o.id),'[]'::jsonb)) INTO v FROM "PurchaseOrder" o WHERE o."tenantId"=t AND o.id=i;
 ELSIF r='EXPENSE' THEN SELECT to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'vat',(SELECT to_jsonb(vatrow)||jsonb_build_object('netAmount',vatrow."netAmount"::text,'taxAmount',vatrow."taxAmount"::text,'recoverableTax',vatrow."recoverableTax"::text) FROM "ExpenseVat" vatrow WHERE vatrow."expenseId"=e.id)) INTO v FROM "Expense" e WHERE e."tenantId"=t AND e.id=i;
 ELSIF r='LEAVE' THEN SELECT to_jsonb(l) INTO v FROM "LeaveRequest" l WHERE l."tenantId"=t AND l.id=i;
 ELSIF r='DOCUMENT' THEN
  SELECT to_jsonb(e)||jsonb_build_object('createdBy',d."createdBy",'revisionAuthorId',e."createdBy") INTO v
  FROM "InternalTextDocumentEvent" e JOIN "InternalTextDocument" d ON d.id=e."documentId" AND d."tenantId"=e."tenantId" AND d."companyId"=e."companyId"
  WHERE e."tenantId"=t AND e.id=i;
 END IF;
 RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION erp_approval_validate_policy(p JSONB,t UUID) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s JSONB;u TEXT;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['title','enabled','resource','currency','minimumAmount','maximumAmount','excludeRequester','stages'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>8 OR jsonb_typeof(p->'resource') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR p->>'resource' NOT IN('PURCHASE','EXPENSE','LEAVE','DOCUMENT') OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'excludeRequester') IS DISTINCT FROM 'boolean' OR p->>'title' ~ '[[:cntrl:]]' OR length(btrim(p->>'title')) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p->'stages')<>'array' OR jsonb_array_length(p->'stages') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid approval configuration' USING ERRCODE='23514'; END IF;
 IF (p->>'currency' IS NOT NULL AND p->>'currency' !~ '^[A-Z]{3}$') OR (p->>'minimumAmount' IS NOT NULL AND jsonb_typeof(p->'minimumAmount')<>'string' OR p->>'minimumAmount' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$') OR (p->>'maximumAmount' IS NOT NULL AND jsonb_typeof(p->'maximumAmount')<>'string' OR p->>'maximumAmount' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$') OR (p->>'minimumAmount' IS NOT NULL OR p->>'maximumAmount' IS NOT NULL) AND p->>'currency' IS NULL OR (p->>'minimumAmount')::numeric>(p->>'maximumAmount')::numeric OR p->>'resource' IN('LEAVE','DOCUMENT') AND (p->>'currency' IS NOT NULL OR p->>'minimumAmount' IS NOT NULL OR p->>'maximumAmount' IS NOT NULL) THEN RAISE EXCEPTION 'Invalid same-currency thresholds' USING ERRCODE='23514'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'stages') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT s ?& ARRAY['name','quorum','userIds','roleIds'] OR (SELECT count(*) FROM jsonb_object_keys(s))<>4 OR jsonb_typeof(s->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'quorum') IS DISTINCT FROM 'number' OR s->>'name' ~ '[[:cntrl:]]' OR length(btrim(s->>'name')) NOT BETWEEN 1 AND 120 OR s->>'quorum' !~ '^[0-9]+$' OR (s->>'quorum')::integer NOT BETWEEN 1 AND 50 OR jsonb_typeof(s->'userIds')<>'array' OR jsonb_typeof(s->'roleIds')<>'array' OR jsonb_array_length(s->'userIds')>100 OR jsonb_array_length(s->'roleIds')>50 OR jsonb_array_length(s->'userIds')+jsonb_array_length(s->'roleIds')=0 OR jsonb_array_length(s->'roleIds')=0 AND (s->>'quorum')::integer>jsonb_array_length(s->'userIds') THEN RAISE EXCEPTION 'Invalid approval stage' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'userIds'))<>jsonb_array_length(s->'userIds') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'roleIds'))<>jsonb_array_length(s->'roleIds') THEN RAISE EXCEPTION 'Duplicate approver' USING ERRCODE='23514'; END IF;
  FOR u IN SELECT jsonb_array_elements_text(s->'userIds') LOOP IF u IS NULL OR u::uuid::text IS DISTINCT FROM u THEN RAISE EXCEPTION 'Approver identifiers must be canonical UUIDs' USING ERRCODE='23514'; END IF; IF (p->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=t AND "userId"=u::uuid AND status='ACTIVE') THEN RAISE EXCEPTION 'Approver is not an active member' USING ERRCODE='23514'; END IF; END LOOP;
  FOR u IN SELECT jsonb_array_elements_text(s->'roleIds') LOOP IF u IS NULL OR u::uuid::text IS DISTINCT FROM u THEN RAISE EXCEPTION 'Approver identifiers must be canonical UUIDs' USING ERRCODE='23514'; END IF; IF (p->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM "Role" WHERE "tenantId"=t AND id=u::uuid) THEN RAISE EXCEPTION 'Unknown approver role' USING ERRCODE='23514'; END IF; END LOOP;
 END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION erp_approval_lock_source(t UUID,r TEXT,i UUID) RETURNS JSONB LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s JSONB;
BEGIN
 IF r='PURCHASE' THEN PERFORM id FROM "PurchaseOrder" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSIF r='EXPENSE' THEN PERFORM id FROM "Expense" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSIF r='LEAVE' THEN PERFORM id FROM "LeaveRequest" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSIF r='DOCUMENT' THEN
  -- Same advisory/row lock order as text editing; reviews never rewrite content.
  SELECT jsonb_build_object('documentId',"documentId") INTO s FROM "InternalTextDocumentEvent" WHERE "tenantId"=t AND id=i;
  PERFORM pg_advisory_xact_lock(hashtextextended('internal-text-document:'||(s->>'documentId'),0));
  PERFORM id FROM "InternalTextDocument" WHERE "tenantId"=t AND id=(s->>'documentId')::uuid FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unknown approval resource'  USING ERRCODE='23514'; END IF;
 s=erp_approval_snapshot(t,r,i);
 IF s IS NULL THEN RAISE EXCEPTION 'Approval source not found' USING ERRCODE='23514'; END IF;
 RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION erp_approval_source_ready(t UUID,r TEXT,s JSONB) RETURNS boolean LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF r='DOCUMENT' THEN
  RETURN EXISTS(SELECT 1 FROM "InternalTextDocument" d WHERE d."tenantId"=t AND d.id=(s->>'documentId')::uuid AND d.version=(s->>'version')::integer AND NOT d.archived AND NOT (s->>'archived')::boolean) AND NOT EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=t AND resource='DOCUMENT' AND "sourceId"=(s->>'id')::uuid AND status='APPROVED');
 ELSIF r='PURCHASE' THEN
  PERFORM id FROM "Supplier" WHERE id=(s->>'supplierId')::uuid FOR SHARE;
  RETURN s->>'status'='DRAFT' AND EXISTS(SELECT 1 FROM "Supplier" WHERE id=(s->>'supplierId')::uuid AND "tenantId"=t AND "companyId"=(s->>'companyId')::uuid AND "archivedAt" IS NULL AND ("branchId" IS NULL OR "branchId"=(s->>'branchId')::uuid));
 ELSIF r='LEAVE' THEN
  PERFORM id FROM "Employee" WHERE id=(s->>'employeeId')::uuid FOR SHARE;
  RETURN s->>'status'='PENDING' AND EXISTS(SELECT 1 FROM "Employee" WHERE id=(s->>'employeeId')::uuid AND "tenantId"=t AND "companyId"=(s->>'companyId')::uuid AND status='ACTIVE' AND "branchId" IS NOT DISTINCT FROM (s->>'branchId')::uuid);
 END IF;
 RETURN r='EXPENSE' AND s->>'status'='DRAFT';
END;
$$;

CREATE OR REPLACE FUNCTION erp_apply_approval_command() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c JSONB;p JSONB;s JSONB;r TEXT;pid UUID;sid UUID;v INTEGER;q "ApprovalRequest"%ROWTYPE;policy "ApprovalPolicy"%ROWTYPE;d "ApprovalDecision"%ROWTYPE;prior RECORD;n INTEGER;final_stage boolean;act TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Approval commands are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Approval commands require READ COMMITTED for current authorization' USING ERRCODE='23514'; END IF;
 c=NEW.command;
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT c ?& ARRAY['requestId','expectedActorId','tenantId','companyId','branchId'] OR (c->>'requestId')::uuid IS DISTINCT FROM NEW.id OR (c->>'expectedActorId')::uuid IS DISTINCT FROM NEW."actorId" OR (c->>'tenantId')::uuid IS DISTINCT FROM NEW."tenantId" OR (c->>'companyId')::uuid IS DISTINCT FROM NEW."companyId" OR (c->>'branchId')::uuid IS DISTINCT FROM NEW."branchId" OR NEW.result IS NOT NULL THEN RAISE EXCEPTION 'Invalid approval command identity' USING ERRCODE='23514'; END IF;
 -- Role-management mutations also lock Tenant. Serialize policy edits and commands with current grants.
 IF c ? 'configuration' THEN PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR UPDATE;
 ELSE PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."actorId" AND status='ACTIVE') THEN RAISE EXCEPTION 'Active membership required' USING ERRCODE='23514'; END IF;
 NEW."createdAt"=clock_timestamp();
 NEW.result=jsonb_build_object('requestId',NEW.id,'actorId',NEW."actorId",'tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'command',c,'outcome',NEW.outcome);
 IF c ? 'configuration' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>8 OR NOT c ?& ARRAY['policyId','expectedVersion','configuration'] OR NOT erp_approval_owner(NEW."actorId",NEW."tenantId") OR jsonb_typeof(c->'expectedVersion') IS DISTINCT FROM 'number' OR c->>'expectedVersion' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Owner policy command required' USING ERRCODE='23514'; END IF;
  pid=(c->>'policyId')::uuid;v=(c->>'expectedVersion')::integer;p=c->'configuration';
  IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
  PERFORM erp_approval_validate_policy(p,NEW."tenantId");
  SELECT * INTO policy FROM "ApprovalPolicy" WHERE id=pid FOR UPDATE;
  IF FOUND THEN
   IF (policy."tenantId",policy."companyId",policy."branchId",policy.version) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",v) THEN RAISE EXCEPTION 'Policy scope or version changed' USING ERRCODE='23514'; END IF;
  ELSIF v<>0 THEN RAISE EXCEPTION 'Policy not found' USING ERRCODE='23514'; END IF;
  IF (p->>'enabled')::boolean AND EXISTS(SELECT 1 FROM "ApprovalPolicy" x WHERE x.id<>pid AND x."tenantId"=NEW."tenantId" AND x."companyId"=NEW."companyId" AND (x."branchId" IS NULL OR NEW."branchId" IS NULL OR x."branchId"=NEW."branchId") AND (x.configuration->>'enabled')::boolean AND x.configuration->>'resource'=p->>'resource' AND (x.configuration->>'currency' IS NULL OR p->>'currency' IS NULL OR x.configuration->>'currency'=p->>'currency') AND COALESCE((x.configuration->>'minimumAmount')::numeric,0)<=COALESCE((p->>'maximumAmount')::numeric,1e30) AND COALESCE((p->>'minimumAmount')::numeric,0)<=COALESCE((x.configuration->>'maximumAmount')::numeric,1e30)) THEN RAISE EXCEPTION 'Enabled policy scopes and thresholds overlap' USING ERRCODE='23514'; END IF;
  INSERT INTO "ApprovalPolicy"(id,"tenantId","companyId","branchId",version,configuration,"createdBy","updatedBy") VALUES(pid,NEW."tenantId",NEW."companyId",NEW."branchId",v+1,p,NEW."actorId",NEW."actorId") ON CONFLICT(id) DO UPDATE SET version=v+1,configuration=p,"updatedBy"=NEW."actorId","updatedAt"=NEW."createdAt" RETURNING * INTO policy;
  INSERT INTO "ApprovalPolicyRevision"(id,"policyId",version,configuration,"actorId","createdAt") VALUES(NEW.id,pid,v+1,p,NEW."actorId",NEW."createdAt");
  -- Advance the tenant tuple epoch without changing its data. An older RR source
  -- writer must fail its tenant row lock rather than miss this new policy.
  UPDATE "Tenant" SET id=id WHERE id=NEW."tenantId";
  NEW.result=NEW.result||jsonb_build_object('policy',to_jsonb(policy));
 ELSIF c ? 'approvalId' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>9 OR NOT c ?& ARRAY['approvalId','expectedVersion','action','reason'] OR jsonb_typeof(c->'expectedVersion') IS DISTINCT FROM 'number' OR c->>'expectedVersion' !~ '^[1-9][0-9]*$' OR jsonb_typeof(c->'reason') IS DISTINCT FROM 'string' OR length(c->>'reason')>500 OR c->>'reason' ~ '[[:cntrl:]]' OR jsonb_typeof(c->'action') IS DISTINCT FROM 'string' OR c->>'action' NOT IN('APPROVE','REJECT','CANCEL') OR (c->>'action'<>'APPROVE' AND length(btrim(c->>'reason'))<3) THEN RAISE EXCEPTION 'Invalid approval decision command' USING ERRCODE='23514'; END IF;
  SELECT * INTO q FROM "ApprovalRequest" WHERE id=(c->>'approvalId')::uuid FOR UPDATE;
  IF NOT FOUND OR (q."tenantId",q."companyId",q."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR NOT erp_approval_access(NEW."actorId",NEW."tenantId",NEW."companyId",NEW."branchId",q.resource) THEN RAISE EXCEPTION 'Current source access required' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
  s=erp_approval_lock_source(q."tenantId",q.resource,q."sourceId");act=c->>'action';
  IF NOT erp_approval_access(NEW."actorId",q."tenantId",q."companyId",q."branchId",q.resource) THEN RAISE EXCEPTION 'Current source access required after locking' USING ERRCODE='23514'; END IF;
  IF q.status<>'PENDING' OR q.version<>(c->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Approval status or version changed' USING ERRCODE='23514'; END IF;
  IF (s->>'companyId')::uuid IS DISTINCT FROM q."companyId" OR (s->>'branchId')::uuid IS DISTINCT FROM q."branchId" THEN RAISE EXCEPTION 'Approval source scope changed' USING ERRCODE='23514'; END IF;
  IF act='CANCEL' THEN
   IF NEW."actorId"<>q."requesterId" AND NOT erp_approval_owner(NEW."actorId",q."tenantId") THEN RAISE EXCEPTION 'Only requester or owner can cancel' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO policy FROM "ApprovalPolicy" WHERE id=q."policyId";
   IF policy.version<>q."policyVersion" OR NOT (policy.configuration->>'enabled')::boolean THEN RAISE EXCEPTION 'Policy changed or paused; cancel and resubmit' USING ERRCODE='23514'; END IF;
   IF NOT erp_approval_source_ready(q."tenantId",q.resource,s) OR md5(s::text)<>q."sourceFingerprint" THEN RAISE EXCEPTION 'Approval source is stale or ineligible' USING ERRCODE='23514'; END IF;
   IF NOT erp_approval_eligible(NEW."actorId",q."tenantId",q."companyId",q."branchId",q."policySnapshot"->'stages'->q.stage) OR (q."policySnapshot"->>'excludeRequester')::boolean AND NEW."actorId" IN(q."requesterId",(q."sourceSnapshot"->>'createdBy')::uuid,(q."sourceSnapshot"->>'revisionAuthorId')::uuid) THEN RAISE EXCEPTION 'Current stage eligibility required; self approval may be prohibited' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO "ApprovalDecision"(id,"approvalId","actorId",stage,action,reason,"createdAt") VALUES(NEW.id,q.id,NEW."actorId",q.stage,act,c->>'reason',NEW."createdAt") RETURNING * INTO d;
  IF act IN('CANCEL','REJECT') THEN
   UPDATE "ApprovalRequest" SET status=CASE act WHEN 'CANCEL' THEN 'CANCELLED' ELSE 'REJECTED' END,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
  ELSE
   SELECT count(*) INTO n FROM "ApprovalDecision" WHERE "approvalId"=q.id AND stage=q.stage AND action='APPROVE';
   final_stage=n>=(q."policySnapshot"->'stages'->q.stage->>'quorum')::integer AND q.stage=jsonb_array_length(q."policySnapshot"->'stages')-1;
   IF final_stage THEN
    FOR prior IN SELECT * FROM "ApprovalDecision" WHERE "approvalId"=q.id AND action='APPROVE' LOOP
     IF NOT erp_approval_access(prior."actorId",q."tenantId",q."companyId",q."branchId",q.resource) OR NOT erp_approval_eligible(prior."actorId",q."tenantId",q."companyId",q."branchId",q."policySnapshot"->'stages'->prior.stage) OR (q."policySnapshot"->>'excludeRequester')::boolean AND prior."actorId" IN(q."requesterId",(q."sourceSnapshot"->>'createdBy')::uuid,(q."sourceSnapshot"->>'revisionAuthorId')::uuid) THEN RAISE EXCEPTION 'A previous voter no longer has current authorization; cancel and resubmit' USING ERRCODE='23514'; END IF;
    END LOOP;
    UPDATE "ApprovalRequest" SET status='APPROVED',version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
    IF q.resource<>'DOCUMENT' THEN
    INSERT INTO "ApprovalFinalizationPermit"("approvalId","decisionId","transactionId","sourceAuditId") VALUES(q.id,d.id,txid_current(),gen_random_uuid());
    IF q.resource='PURCHASE' THEN UPDATE "PurchaseOrder" SET status='ISSUED',"issuedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='DRAFT';
    ELSIF q.resource='EXPENSE' THEN UPDATE "Expense" SET status='POSTED',"postedAt"=NEW."createdAt","updatedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='DRAFT';
    ELSE UPDATE "LeaveRequest" SET status='APPROVED',"decidedAt"=NEW."createdAt","decidedBy"=NEW."actorId","decisionNote"=NULLIF(c->>'reason',''),"updatedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='PENDING'; END IF;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Source transition did not complete' USING ERRCODE='23514'; END IF;
    INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") SELECT "sourceAuditId",q."tenantId",NEW."actorId",CASE q.resource WHEN 'PURCHASE' THEN 'purchase-order.issued' WHEN 'EXPENSE' THEN 'expense.posted' ELSE 'leave-request.approved' END,CASE q.resource WHEN 'PURCHASE' THEN 'PurchaseOrder' WHEN 'EXPENSE' THEN 'Expense' ELSE 'LeaveRequest' END,q."sourceId"::text,jsonb_build_object('approvalCommandId',NEW.id,'approvalId',q.id),NEW."createdAt" FROM "ApprovalFinalizationPermit" WHERE "approvalId"=q.id;
    END IF; -- DOCUMENT approves only this immutable revision, without publishing or editing.
   ELSE
    UPDATE "ApprovalRequest" SET stage=stage+CASE WHEN n>=(q."policySnapshot"->'stages'->q.stage->>'quorum')::integer THEN 1 ELSE 0 END,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
   END IF;
  END IF;
  NEW.result=NEW.result||jsonb_build_object('approval',to_jsonb(q),'decision',to_jsonb(d));
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>10 OR NOT c ?& ARRAY['resource','sourceId','policyId','policyVersion','sourceFingerprint'] OR jsonb_typeof(c->'resource') IS DISTINCT FROM 'string' OR c->>'resource' NOT IN('PURCHASE','EXPENSE','LEAVE','DOCUMENT') OR jsonb_typeof(c->'policyVersion') IS DISTINCT FROM 'number' OR c->>'policyVersion' !~ '^[1-9][0-9]*$' OR jsonb_typeof(c->'sourceFingerprint') IS DISTINCT FROM 'string' OR c->>'sourceFingerprint' !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Invalid approval submission' USING ERRCODE='23514'; END IF;
  r=c->>'resource';sid=(c->>'sourceId')::uuid;pid=(c->>'policyId')::uuid;
  IF NOT erp_approval_access(NEW."actorId",NEW."tenantId",NEW."companyId",NEW."branchId",r) THEN RAISE EXCEPTION 'Current source read and action access required' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
  s=erp_approval_lock_source(NEW."tenantId",r,sid);
  IF (s->>'companyId')::uuid IS DISTINCT FROM NEW."companyId" OR (s->>'branchId')::uuid IS DISTINCT FROM NEW."branchId" OR NOT erp_approval_source_ready(NEW."tenantId",r,s) OR md5(s::text)<>c->>'sourceFingerprint' THEN RAISE EXCEPTION 'Approval source preview is stale or ineligible' USING ERRCODE='23514'; END IF;
  IF NOT erp_approval_access(NEW."actorId",NEW."tenantId",NEW."companyId",NEW."branchId",r) THEN RAISE EXCEPTION 'Current source access required after locking' USING ERRCODE='23514'; END IF;
  SELECT * INTO policy FROM "ApprovalPolicy" WHERE id=pid AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND ("branchId" IS NULL OR "branchId"=NEW."branchId");
  IF NOT FOUND OR policy.version<>(c->>'policyVersion')::integer OR NOT erp_approval_matches(policy.configuration,s,r) THEN RAISE EXCEPTION 'Matching policy preview changed' USING ERRCODE='23514'; END IF;
  INSERT INTO "ApprovalRequest"(id,"tenantId","companyId","branchId",resource,"sourceId","policyId","policyVersion","policySnapshot","sourceSnapshot","sourceFingerprint","requesterId",status,stage,version,"createdAt","updatedAt") VALUES(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",r,sid,pid,policy.version,policy.configuration,s,md5(s::text),NEW."actorId",'PENDING',0,1,NEW."createdAt",NEW."createdAt") RETURNING * INTO q;
  IF r='DOCUMENT' THEN INSERT INTO "DocumentApprovalSource"("approvalId","eventId") VALUES(q.id,sid); END IF;
  -- Likewise fence older RR source writers from missing the new pending request.
  -- No source content/timestamp changes; the frozen snapshot remains exact.
  IF r='PURCHASE' THEN UPDATE "PurchaseOrder" SET id=id WHERE id=sid;
  ELSIF r='EXPENSE' THEN UPDATE "Expense" SET id=id WHERE id=sid;
  ELSIF r='LEAVE' THEN UPDATE "LeaveRequest" SET id=id WHERE id=sid; END IF;
  NEW.result=NEW.result||jsonb_build_object('approval',to_jsonb(q));
 END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE n TEXT;r TEXT;f TEXT; BEGIN
 FOREACH n IN ARRAY ARRAY['ApprovalCommand','ApprovalPolicy','ApprovalPolicyRevision','ApprovalRequest','ApprovalDecision','ApprovalFinalizationPermit','DocumentApprovalSource'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',n);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',n,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'erp_approval_%' OR p.proname IN('erp_apply_approval_command','erp_audit_approval_command','erp_guard_approval_audit')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
