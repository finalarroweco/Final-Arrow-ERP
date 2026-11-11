BEGIN;
-- No policies or approval requests are enabled or enrolled by this migration.
CREATE TABLE "ApprovalCommand" (
 id UUID PRIMARY KEY REFERENCES "AuditLog"(id) DEFERRABLE INITIALLY DEFERRED,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 "actorId" UUID NOT NULL,command JSONB NOT NULL,outcome TEXT NOT NULL CHECK(outcome IN('COMMITTED','ABANDONED')),
 result JSONB,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","actorId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE TABLE "ApprovalPolicy" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 version INTEGER NOT NULL CHECK(version>0),configuration JSONB NOT NULL,"createdBy" UUID NOT NULL,"updatedBy" UUID NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE INDEX "ApprovalPolicy_scope_idx" ON "ApprovalPolicy"("tenantId","companyId","branchId");
CREATE TABLE "ApprovalPolicyRevision" (
 id UUID PRIMARY KEY REFERENCES "ApprovalCommand"(id) DEFERRABLE INITIALLY DEFERRED,
 "policyId" UUID NOT NULL REFERENCES "ApprovalPolicy"(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL,configuration JSONB NOT NULL,"actorId" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("policyId",version)
);
CREATE TABLE "ApprovalRequest" (
 id UUID PRIMARY KEY REFERENCES "ApprovalCommand"(id) DEFERRABLE INITIALLY DEFERRED,
 "tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,resource TEXT NOT NULL CHECK(resource IN('PURCHASE','EXPENSE','LEAVE')),"sourceId" UUID NOT NULL,
 "purchaseOrderId" UUID GENERATED ALWAYS AS (CASE WHEN resource='PURCHASE' THEN "sourceId" END) STORED,
 "expenseId" UUID GENERATED ALWAYS AS (CASE WHEN resource='EXPENSE' THEN "sourceId" END) STORED,
 "leaveRequestId" UUID GENERATED ALWAYS AS (CASE WHEN resource='LEAVE' THEN "sourceId" END) STORED,
 FOREIGN KEY("tenantId","purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","expenseId") REFERENCES "Expense"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","leaveRequestId") REFERENCES "LeaveRequest"("tenantId",id) ON DELETE RESTRICT,
 "policyId" UUID NOT NULL REFERENCES "ApprovalPolicy"(id),"policyVersion" INTEGER NOT NULL,
 "policySnapshot" JSONB NOT NULL,"sourceSnapshot" JSONB NOT NULL,"sourceFingerprint" TEXT NOT NULL,
 "requesterId" UUID NOT NULL,status TEXT NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
 stage INTEGER NOT NULL CHECK(stage>=0),version INTEGER NOT NULL CHECK(version>0),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("policyId","policyVersion") REFERENCES "ApprovalPolicyRevision"("policyId",version),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","requesterId") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "ApprovalRequest_pending_source_key" ON "ApprovalRequest"("tenantId",resource,"sourceId") WHERE status='PENDING';
CREATE INDEX "ApprovalRequest_scope_idx" ON "ApprovalRequest"("tenantId","companyId","branchId","createdAt",id);
CREATE TABLE "ApprovalDecision" (
 id UUID PRIMARY KEY REFERENCES "ApprovalCommand"(id) DEFERRABLE INITIALLY DEFERRED,
 "approvalId" UUID NOT NULL REFERENCES "ApprovalRequest"(id),"actorId" UUID NOT NULL,stage INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN('APPROVE','REJECT','CANCEL')),reason TEXT NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ApprovalDecision_vote_key" ON "ApprovalDecision"("approvalId",stage,"actorId") WHERE action='APPROVE';
CREATE TABLE "ApprovalFinalizationPermit" (
 "approvalId" UUID PRIMARY KEY REFERENCES "ApprovalRequest"(id),"decisionId" UUID NOT NULL UNIQUE REFERENCES "ApprovalDecision"(id),"transactionId" BIGINT NOT NULL,"sourceAuditId" UUID NOT NULL UNIQUE REFERENCES "AuditLog"(id) DEFERRABLE INITIALLY DEFERRED,consumed BOOLEAN NOT NULL DEFAULT false
);
CREATE FUNCTION erp_approval_owner(u UUID,t UUID) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Membership" m JOIN "RoleGrant" g ON g."tenantId"=m."tenantId" AND g."membershipId"=m.id JOIN "Role" r ON r.id=g."roleId" JOIN "AccessScope" s ON s."grantId"=g.id WHERE m."tenantId"=t AND m."userId"=u AND m.status='ACTIVE' AND r.name='Owner' AND s.type='TENANT');
$$;
CREATE FUNCTION erp_approval_access(u UUID,t UUID,c UUID,b UUID,r TEXT) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE r WHEN 'PURCHASE' THEN erp_payment_term_actor_access(u,t,c,b,'purchase-order:read') AND erp_payment_term_actor_access(u,t,c,b,'purchase-order:manage') WHEN 'EXPENSE' THEN erp_payment_term_actor_access(u,t,c,b,'expense:read') AND erp_payment_term_actor_access(u,t,c,b,'expense:post') WHEN 'LEAVE' THEN erp_payment_term_actor_access(u,t,c,b,'leave:read') AND erp_payment_term_actor_access(u,t,c,b,'leave:decide') ELSE false END;
$$;
CREATE FUNCTION erp_approval_eligible(u UUID,t UUID,c UUID,b UUID,s JSONB) RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Membership" m WHERE m."tenantId"=t AND m."userId"=u AND m.status='ACTIVE') AND
 (s->'userIds' ? u::text OR EXISTS(SELECT 1 FROM "Membership" m JOIN "RoleGrant" g ON g."tenantId"=m."tenantId" AND g."membershipId"=m.id JOIN "AccessScope" a ON a."tenantId"=g."tenantId" AND a."grantId"=g.id WHERE m."tenantId"=t AND m."userId"=u AND m.status='ACTIVE' AND s->'roleIds' ? g."roleId"::text AND (a.type='TENANT' OR (a."companyId"=c AND (a.type='COMPANY' OR (a.type='BRANCH' AND b IS NOT NULL AND a."branchId"=b))))));
$$;
CREATE FUNCTION erp_approval_snapshot(t UUID,r TEXT,i UUID) RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE v JSONB;
BEGIN
 IF r='PURCHASE' THEN SELECT to_jsonb(o)||jsonb_build_object('subtotal',o.subtotal::text,'lines',COALESCE((SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('unitPrice',l."unitPrice"::text,'amount',l.amount::text) ORDER BY l.position,l.id) FROM "PurchaseOrderLine" l WHERE l."orderId"=o.id),'[]'::jsonb)) INTO v FROM "PurchaseOrder" o WHERE o."tenantId"=t AND o.id=i;
 ELSIF r='EXPENSE' THEN SELECT to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'vat',(SELECT to_jsonb(vatrow)||jsonb_build_object('netAmount',vatrow."netAmount"::text,'taxAmount',vatrow."taxAmount"::text,'recoverableTax',vatrow."recoverableTax"::text) FROM "ExpenseVat" vatrow WHERE vatrow."expenseId"=e.id)) INTO v FROM "Expense" e WHERE e."tenantId"=t AND e.id=i;
 ELSIF r='LEAVE' THEN SELECT to_jsonb(l) INTO v FROM "LeaveRequest" l WHERE l."tenantId"=t AND l.id=i;
 END IF;
 RETURN v;
END;
$$;
CREATE FUNCTION erp_approval_matches(p JSONB,s JSONB,r TEXT) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT COALESCE((p->>'enabled')::boolean,false) AND p->>'resource'=r
 AND (p->>'currency' IS NULL OR p->>'currency'=s->>'currency')
 AND (p->>'minimumAmount' IS NULL OR (CASE r WHEN 'PURCHASE' THEN s->>'subtotal' ELSE s->>'amount' END)::numeric >= (p->>'minimumAmount')::numeric)
 AND (p->>'maximumAmount' IS NULL OR (CASE r WHEN 'PURCHASE' THEN s->>'subtotal' ELSE s->>'amount' END)::numeric <= (p->>'maximumAmount')::numeric);
$$;
CREATE FUNCTION erp_approval_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='TRUNCATE' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Approval projections and history are command managed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' OR (TG_TABLE_NAME IN('ApprovalPolicyRevision','ApprovalDecision') AND TG_OP='UPDATE') THEN RAISE EXCEPTION 'Approval history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ApprovalFinalizationPermit' AND TG_OP='UPDATE' AND ((to_jsonb(OLD)->>'consumed')::boolean OR NOT (to_jsonb(NEW)->>'consumed')::boolean OR (to_jsonb(OLD)-'consumed') IS DISTINCT FROM (to_jsonb(NEW)-'consumed')) THEN RAISE EXCEPTION 'Approval permit is single use' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
DO $$ DECLARE n TEXT; BEGIN FOREACH n IN ARRAY ARRAY['ApprovalPolicy','ApprovalPolicyRevision','ApprovalRequest','ApprovalDecision','ApprovalFinalizationPermit'] LOOP
 EXECUTE format('CREATE TRIGGER approval_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION erp_approval_projection_guard()',n);
 EXECUTE format('CREATE TRIGGER approval_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION erp_approval_projection_guard()',n);
END LOOP; END $$;
CREATE FUNCTION erp_approval_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r TEXT;s JSONB;i UUID;t UUID;a "ApprovalRequest"%ROWTYPE;target TEXT;permitted boolean=false;oldrow JSONB;permitid UUID;
BEGIN
 r=CASE TG_TABLE_NAME WHEN 'PurchaseOrder' THEN 'PURCHASE' WHEN 'Expense' THEN 'EXPENSE' ELSE 'LEAVE' END;
 IF TG_OP='DELETE' THEN s=to_jsonb(OLD); ELSE s=to_jsonb(NEW); END IF;
 IF TG_OP<>'INSERT' THEN oldrow=to_jsonb(OLD); END IF;
 i=(s->>'id')::uuid;t=(s->>'tenantId')::uuid;target=CASE r WHEN 'PURCHASE' THEN 'ISSUED' WHEN 'EXPENSE' THEN 'POSTED' ELSE 'APPROVED' END;
 PERFORM id FROM "Tenant" WHERE id IN(t,(oldrow->>'tenantId')::uuid) ORDER BY id FOR SHARE;
 IF TG_OP='UPDATE' AND (s->>'id',s->>'tenantId',s->>'companyId',s->>'branchId') IS DISTINCT FROM (oldrow->>'id',oldrow->>'tenantId',oldrow->>'companyId',oldrow->>'branchId') AND EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE resource=r AND "sourceId"=(oldrow->>'id')::uuid) THEN RAISE EXCEPTION 'Source with approval history cannot move scope' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=t AND resource=r AND "sourceId"=i) THEN RAISE EXCEPTION 'Source has retained approval history' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND s->>'status'=target AND oldrow->>'status'<>target THEN
  SELECT q.* INTO a FROM "ApprovalFinalizationPermit" p JOIN "ApprovalRequest" q ON q.id=p."approvalId" JOIN "ApprovalDecision" d ON d.id=p."decisionId" WHERE q."tenantId"=t AND q.resource=r AND q."sourceId"=i AND q.status='APPROVED' AND p."transactionId"=txid_current() AND NOT p.consumed AND d.action='APPROVE';
  IF FOUND AND (oldrow||CASE r WHEN 'PURCHASE' THEN jsonb_build_object('subtotal',oldrow->>'subtotal') WHEN 'EXPENSE' THEN jsonb_build_object('amount',oldrow->>'amount') ELSE '{}'::jsonb END)=(a."sourceSnapshot"-'lines'-'vat') AND (s-ARRAY['status','issuedAt','postedAt','decidedAt','decidedBy','decisionNote','updatedAt'])=(oldrow-ARRAY['status','issuedAt','postedAt','decidedAt','decidedBy','decisionNote','updatedAt']) THEN
   UPDATE "ApprovalFinalizationPermit" SET consumed=true WHERE "approvalId"=a.id AND NOT consumed;permitted=FOUND;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE "tenantId"=t AND resource=r AND "sourceId"=i AND status='PENDING') AND NOT permitted THEN
  IF TG_OP='DELETE' OR TG_OP='UPDATE' AND oldrow IS DISTINCT FROM s THEN RAISE EXCEPTION 'Cancel the pending approval before editing or changing its source' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP<>'DELETE' AND s->>'status'=target AND (TG_OP='INSERT' OR oldrow->>'status' IS DISTINCT FROM target) AND NOT permitted AND EXISTS(SELECT 1 FROM "ApprovalPolicy" p WHERE (p."tenantId"=t AND p."companyId"=(s->>'companyId')::uuid AND (p."branchId" IS NULL OR p."branchId"=(s->>'branchId')::uuid) AND erp_approval_matches(p.configuration,s,r)) OR (p."tenantId"=(oldrow->>'tenantId')::uuid AND p."companyId"=(oldrow->>'companyId')::uuid AND (p."branchId" IS NULL OR p."branchId"=(oldrow->>'branchId')::uuid) AND erp_approval_matches(p.configuration,oldrow,r))) THEN RAISE EXCEPTION 'Configured workflow approval is required' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END;
$$;
CREATE TRIGGER approval_purchase_guard BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION erp_approval_source_guard();
CREATE TRIGGER approval_expense_guard BEFORE INSERT OR UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION erp_approval_source_guard();
CREATE TRIGGER approval_leave_guard BEFORE INSERT OR UPDATE OR DELETE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION erp_approval_source_guard();
CREATE FUNCTION erp_approval_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v JSONB;r TEXT;i UUID;oldi UUID;
BEGIN
 IF TG_OP='DELETE' THEN v=to_jsonb(OLD); ELSE v=to_jsonb(NEW); END IF;
 r=CASE TG_TABLE_NAME WHEN 'PurchaseOrderLine' THEN 'PURCHASE' ELSE 'EXPENSE' END;
 i=(v->>CASE r WHEN 'PURCHASE' THEN 'orderId' ELSE 'expenseId' END)::uuid;
 IF TG_OP='UPDATE' THEN oldi=(to_jsonb(OLD)->>CASE r WHEN 'PURCHASE' THEN 'orderId' ELSE 'expenseId' END)::uuid; END IF;
 IF r='PURCHASE' THEN PERFORM id FROM "PurchaseOrder" WHERE id IN(i,oldi) ORDER BY id FOR UPDATE;
 ELSE PERFORM id FROM "Expense" WHERE id IN(i,oldi) ORDER BY id FOR UPDATE; END IF;
 IF EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE resource=r AND "sourceId" IN(i,oldi) AND status='PENDING') THEN RAISE EXCEPTION 'Cancel pending approval before editing source details' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
CREATE TRIGGER approval_purchase_line_guard BEFORE INSERT OR UPDATE OR DELETE ON "PurchaseOrderLine" FOR EACH ROW EXECUTE FUNCTION erp_approval_child_guard();
CREATE TRIGGER approval_expense_vat_guard BEFORE INSERT OR UPDATE OR DELETE ON "ExpenseVat" FOR EACH ROW EXECUTE FUNCTION erp_approval_child_guard();
CREATE FUNCTION erp_approval_validate_policy(p JSONB,t UUID) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s JSONB;u TEXT;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['title','enabled','resource','currency','minimumAmount','maximumAmount','excludeRequester','stages'] OR (SELECT count(*) FROM jsonb_object_keys(p))<>8 OR jsonb_typeof(p->'resource') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR p->>'resource' NOT IN('PURCHASE','EXPENSE','LEAVE') OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p->'excludeRequester') IS DISTINCT FROM 'boolean' OR p->>'title' ~ '[[:cntrl:]]' OR length(btrim(p->>'title')) NOT BETWEEN 1 AND 160 OR jsonb_typeof(p->'stages')<>'array' OR jsonb_array_length(p->'stages') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid approval configuration' USING ERRCODE='23514'; END IF;
 IF (p->>'currency' IS NOT NULL AND p->>'currency' !~ '^[A-Z]{3}$') OR (p->>'minimumAmount' IS NOT NULL AND jsonb_typeof(p->'minimumAmount')<>'string' OR p->>'minimumAmount' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$') OR (p->>'maximumAmount' IS NOT NULL AND jsonb_typeof(p->'maximumAmount')<>'string' OR p->>'maximumAmount' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$') OR (p->>'minimumAmount' IS NOT NULL OR p->>'maximumAmount' IS NOT NULL) AND p->>'currency' IS NULL OR (p->>'minimumAmount')::numeric>(p->>'maximumAmount')::numeric OR p->>'resource'='LEAVE' AND (p->>'currency' IS NOT NULL OR p->>'minimumAmount' IS NOT NULL OR p->>'maximumAmount' IS NOT NULL) THEN RAISE EXCEPTION 'Invalid same-currency thresholds' USING ERRCODE='23514'; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p->'stages') LOOP
  IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT s ?& ARRAY['name','quorum','userIds','roleIds'] OR (SELECT count(*) FROM jsonb_object_keys(s))<>4 OR jsonb_typeof(s->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(s->'quorum') IS DISTINCT FROM 'number' OR s->>'name' ~ '[[:cntrl:]]' OR length(btrim(s->>'name')) NOT BETWEEN 1 AND 120 OR s->>'quorum' !~ '^[0-9]+$' OR (s->>'quorum')::integer NOT BETWEEN 1 AND 50 OR jsonb_typeof(s->'userIds')<>'array' OR jsonb_typeof(s->'roleIds')<>'array' OR jsonb_array_length(s->'userIds')>100 OR jsonb_array_length(s->'roleIds')>50 OR jsonb_array_length(s->'userIds')+jsonb_array_length(s->'roleIds')=0 OR jsonb_array_length(s->'roleIds')=0 AND (s->>'quorum')::integer>jsonb_array_length(s->'userIds') THEN RAISE EXCEPTION 'Invalid approval stage' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'userIds'))<>jsonb_array_length(s->'userIds') OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(s->'roleIds'))<>jsonb_array_length(s->'roleIds') THEN RAISE EXCEPTION 'Duplicate approver' USING ERRCODE='23514'; END IF;
  FOR u IN SELECT jsonb_array_elements_text(s->'userIds') LOOP IF u IS NULL OR u::uuid::text IS DISTINCT FROM u THEN RAISE EXCEPTION 'Approver identifiers must be canonical UUIDs' USING ERRCODE='23514'; END IF; IF (p->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=t AND "userId"=u::uuid AND status='ACTIVE') THEN RAISE EXCEPTION 'Approver is not an active member' USING ERRCODE='23514'; END IF; END LOOP;
  FOR u IN SELECT jsonb_array_elements_text(s->'roleIds') LOOP IF u IS NULL OR u::uuid::text IS DISTINCT FROM u THEN RAISE EXCEPTION 'Approver identifiers must be canonical UUIDs' USING ERRCODE='23514'; END IF; IF (p->>'enabled')::boolean AND NOT EXISTS(SELECT 1 FROM "Role" WHERE "tenantId"=t AND id=u::uuid) THEN RAISE EXCEPTION 'Unknown approver role' USING ERRCODE='23514'; END IF; END LOOP;
 END LOOP;
END;
$$;
CREATE FUNCTION erp_approval_lock_source(t UUID,r TEXT,i UUID) RETURNS JSONB LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s JSONB;
BEGIN
 IF r='PURCHASE' THEN PERFORM id FROM "PurchaseOrder" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSIF r='EXPENSE' THEN PERFORM id FROM "Expense" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSIF r='LEAVE' THEN PERFORM id FROM "LeaveRequest" WHERE "tenantId"=t AND id=i FOR UPDATE;
 ELSE RAISE EXCEPTION 'Unknown approval resource' USING ERRCODE='23514'; END IF;
 s=erp_approval_snapshot(t,r,i);
 IF s IS NULL THEN RAISE EXCEPTION 'Approval source not found' USING ERRCODE='23514'; END IF;
 RETURN s;
END;
$$;
CREATE FUNCTION erp_approval_source_ready(t UUID,r TEXT,s JSONB) RETURNS boolean LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF r='PURCHASE' THEN
  PERFORM id FROM "Supplier" WHERE id=(s->>'supplierId')::uuid FOR SHARE;
  RETURN s->>'status'='DRAFT' AND EXISTS(SELECT 1 FROM "Supplier" WHERE id=(s->>'supplierId')::uuid AND "tenantId"=t AND "companyId"=(s->>'companyId')::uuid AND "archivedAt" IS NULL AND ("branchId" IS NULL OR "branchId"=(s->>'branchId')::uuid));
 ELSIF r='LEAVE' THEN
  PERFORM id FROM "Employee" WHERE id=(s->>'employeeId')::uuid FOR SHARE;
  RETURN s->>'status'='PENDING' AND EXISTS(SELECT 1 FROM "Employee" WHERE id=(s->>'employeeId')::uuid AND "tenantId"=t AND "companyId"=(s->>'companyId')::uuid AND status='ACTIVE' AND "branchId" IS NOT DISTINCT FROM (s->>'branchId')::uuid);
 END IF;
 RETURN r='EXPENSE' AND s->>'status'='DRAFT';
END;
$$;
CREATE FUNCTION erp_apply_approval_command() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
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
   IF NOT erp_approval_eligible(NEW."actorId",q."tenantId",q."companyId",q."branchId",q."policySnapshot"->'stages'->q.stage) OR (q."policySnapshot"->>'excludeRequester')::boolean AND NEW."actorId" IN(q."requesterId",(q."sourceSnapshot"->>'createdBy')::uuid) THEN RAISE EXCEPTION 'Current stage eligibility required; self approval may be prohibited' USING ERRCODE='23514'; END IF;
  END IF;
  INSERT INTO "ApprovalDecision"(id,"approvalId","actorId",stage,action,reason,"createdAt") VALUES(NEW.id,q.id,NEW."actorId",q.stage,act,c->>'reason',NEW."createdAt") RETURNING * INTO d;
  IF act IN('CANCEL','REJECT') THEN
   UPDATE "ApprovalRequest" SET status=CASE act WHEN 'CANCEL' THEN 'CANCELLED' ELSE 'REJECTED' END,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
  ELSE
   SELECT count(*) INTO n FROM "ApprovalDecision" WHERE "approvalId"=q.id AND stage=q.stage AND action='APPROVE';
   final_stage=n>=(q."policySnapshot"->'stages'->q.stage->>'quorum')::integer AND q.stage=jsonb_array_length(q."policySnapshot"->'stages')-1;
   IF final_stage THEN
    FOR prior IN SELECT * FROM "ApprovalDecision" WHERE "approvalId"=q.id AND action='APPROVE' LOOP
     IF NOT erp_approval_access(prior."actorId",q."tenantId",q."companyId",q."branchId",q.resource) OR NOT erp_approval_eligible(prior."actorId",q."tenantId",q."companyId",q."branchId",q."policySnapshot"->'stages'->prior.stage) OR (q."policySnapshot"->>'excludeRequester')::boolean AND prior."actorId" IN(q."requesterId",(q."sourceSnapshot"->>'createdBy')::uuid) THEN RAISE EXCEPTION 'A previous voter no longer has current authorization; cancel and resubmit' USING ERRCODE='23514'; END IF;
    END LOOP;
    UPDATE "ApprovalRequest" SET status='APPROVED',version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
    INSERT INTO "ApprovalFinalizationPermit"("approvalId","decisionId","transactionId","sourceAuditId") VALUES(q.id,d.id,txid_current(),gen_random_uuid());
    IF q.resource='PURCHASE' THEN UPDATE "PurchaseOrder" SET status='ISSUED',"issuedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='DRAFT';
    ELSIF q.resource='EXPENSE' THEN UPDATE "Expense" SET status='POSTED',"postedAt"=NEW."createdAt","updatedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='DRAFT';
    ELSE UPDATE "LeaveRequest" SET status='APPROVED',"decidedAt"=NEW."createdAt","decidedBy"=NEW."actorId","decisionNote"=NULLIF(c->>'reason',''),"updatedAt"=NEW."createdAt" WHERE id=q."sourceId" AND status='PENDING'; END IF;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Source transition did not complete' USING ERRCODE='23514'; END IF;
    INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") SELECT "sourceAuditId",q."tenantId",NEW."actorId",CASE q.resource WHEN 'PURCHASE' THEN 'purchase-order.issued' WHEN 'EXPENSE' THEN 'expense.posted' ELSE 'leave-request.approved' END,CASE q.resource WHEN 'PURCHASE' THEN 'PurchaseOrder' WHEN 'EXPENSE' THEN 'Expense' ELSE 'LeaveRequest' END,q."sourceId"::text,jsonb_build_object('approvalCommandId',NEW.id,'approvalId',q.id),NEW."createdAt" FROM "ApprovalFinalizationPermit" WHERE "approvalId"=q.id;
   ELSE
    UPDATE "ApprovalRequest" SET stage=stage+CASE WHEN n>=(q."policySnapshot"->'stages'->q.stage->>'quorum')::integer THEN 1 ELSE 0 END,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=q.id RETURNING * INTO q;
   END IF;
  END IF;
  NEW.result=NEW.result||jsonb_build_object('approval',to_jsonb(q),'decision',to_jsonb(d));
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(c))<>10 OR NOT c ?& ARRAY['resource','sourceId','policyId','policyVersion','sourceFingerprint'] OR jsonb_typeof(c->'resource') IS DISTINCT FROM 'string' OR c->>'resource' NOT IN('PURCHASE','EXPENSE','LEAVE') OR jsonb_typeof(c->'policyVersion') IS DISTINCT FROM 'number' OR c->>'policyVersion' !~ '^[1-9][0-9]*$' OR jsonb_typeof(c->'sourceFingerprint') IS DISTINCT FROM 'string' OR c->>'sourceFingerprint' !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'Invalid approval submission' USING ERRCODE='23514'; END IF;
  r=c->>'resource';sid=(c->>'sourceId')::uuid;pid=(c->>'policyId')::uuid;
  IF NOT erp_approval_access(NEW."actorId",NEW."tenantId",NEW."companyId",NEW."branchId",r) THEN RAISE EXCEPTION 'Current source read and action access required' USING ERRCODE='23514'; END IF;
  IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
  s=erp_approval_lock_source(NEW."tenantId",r,sid);
  IF (s->>'companyId')::uuid IS DISTINCT FROM NEW."companyId" OR (s->>'branchId')::uuid IS DISTINCT FROM NEW."branchId" OR NOT erp_approval_source_ready(NEW."tenantId",r,s) OR md5(s::text)<>c->>'sourceFingerprint' THEN RAISE EXCEPTION 'Approval source preview is stale or ineligible' USING ERRCODE='23514'; END IF;
  IF NOT erp_approval_access(NEW."actorId",NEW."tenantId",NEW."companyId",NEW."branchId",r) THEN RAISE EXCEPTION 'Current source access required after locking' USING ERRCODE='23514'; END IF;
  SELECT * INTO policy FROM "ApprovalPolicy" WHERE id=pid AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND ("branchId" IS NULL OR "branchId"=NEW."branchId");
  IF NOT FOUND OR policy.version<>(c->>'policyVersion')::integer OR NOT erp_approval_matches(policy.configuration,s,r) THEN RAISE EXCEPTION 'Matching policy preview changed' USING ERRCODE='23514'; END IF;
  INSERT INTO "ApprovalRequest"(id,"tenantId","companyId","branchId",resource,"sourceId","policyId","policyVersion","policySnapshot","sourceSnapshot","sourceFingerprint","requesterId",status,stage,version,"createdAt","updatedAt") VALUES(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",r,sid,pid,policy.version,policy.configuration,s,md5(s::text),NEW."actorId",'PENDING',0,1,NEW."createdAt",NEW."createdAt") RETURNING * INTO q;
  -- Likewise fence older RR source writers from missing the new pending request.
  -- No source content/timestamp changes; the frozen snapshot remains exact.
  IF r='PURCHASE' THEN UPDATE "PurchaseOrder" SET id=id WHERE id=sid;
  ELSIF r='EXPENSE' THEN UPDATE "Expense" SET id=id WHERE id=sid;
  ELSE UPDATE "LeaveRequest" SET id=id WHERE id=sid; END IF;
  NEW.result=NEW.result||jsonb_build_object('approval',to_jsonb(q));
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER apply_approval_command BEFORE INSERT OR UPDATE OR DELETE ON "ApprovalCommand" FOR EACH ROW EXECUTE FUNCTION erp_apply_approval_command();
CREATE TRIGGER approval_command_truncate BEFORE TRUNCATE ON "ApprovalCommand" FOR EACH STATEMENT EXECUTE FUNCTION erp_approval_projection_guard();
CREATE FUNCTION erp_audit_approval_command() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(NEW.id,NEW."tenantId",NEW."actorId",'approval.'||lower(NEW.outcome),'ApprovalCommand',NEW.id::text,jsonb_build_object('commandId',NEW.id),NEW."createdAt");
 RETURN NEW;
END;
$$;
CREATE TRIGGER audit_approval_command AFTER INSERT ON "ApprovalCommand" FOR EACH ROW EXECUTE FUNCTION erp_audit_approval_command();
CREATE FUNCTION erp_guard_approval_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.metadata ? 'approvalCommandId' AND (pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM "ApprovalFinalizationPermit" WHERE "sourceAuditId"=NEW.id AND "transactionId"=txid_current())) THEN RAISE EXCEPTION 'Finalization audit requires current permit' USING ERRCODE='23514'; END IF;
  IF NEW.entity='ApprovalCommand' AND (pg_trigger_depth()<2 OR NOT EXISTS(SELECT 1 FROM "ApprovalCommand" WHERE id=NEW.id AND "tenantId"=NEW."tenantId" AND "actorId"=NEW."actorId")) THEN RAISE EXCEPTION 'Approval audit must originate from command' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.entity='ApprovalCommand' OR NEW.entity='ApprovalCommand' OR EXISTS(SELECT 1 FROM "ApprovalFinalizationPermit" WHERE "sourceAuditId"=OLD.id OR "sourceAuditId"=NEW.id) THEN RAISE EXCEPTION 'Approval audit is immutable' USING ERRCODE='23514'; END IF;
 END IF;IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END;
$$;
CREATE TRIGGER guard_approval_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_approval_audit();
CREATE FUNCTION erp_approval_source_truncate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r TEXT;
BEGIN
 IF TG_TABLE_NAME='AuditLog' THEN
  IF EXISTS(SELECT 1 FROM "ApprovalCommand") THEN RAISE EXCEPTION 'Approval audit history cannot be truncated' USING ERRCODE='23514'; END IF;
 ELSE
  r=CASE TG_TABLE_NAME WHEN 'PurchaseOrder' THEN 'PURCHASE' WHEN 'PurchaseOrderLine' THEN 'PURCHASE' WHEN 'Expense' THEN 'EXPENSE' WHEN 'ExpenseVat' THEN 'EXPENSE' ELSE 'LEAVE' END;
  IF EXISTS(SELECT 1 FROM "ApprovalRequest" WHERE resource=r AND (TG_TABLE_NAME IN('PurchaseOrder','Expense','LeaveRequest') OR status='PENDING')) THEN RAISE EXCEPTION 'Approval source history cannot be truncated' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END;
$$;
DO $$ DECLARE n TEXT;BEGIN FOREACH n IN ARRAY ARRAY['PurchaseOrder','PurchaseOrderLine','Expense','ExpenseVat','LeaveRequest','AuditLog'] LOOP EXECUTE format('CREATE TRIGGER approval_source_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION erp_approval_source_truncate_guard()',n); END LOOP;END $$;
DO $$ DECLARE n TEXT;r TEXT;f TEXT; BEGIN
 FOREACH n IN ARRAY ARRAY['ApprovalCommand','ApprovalPolicy','ApprovalPolicyRevision','ApprovalRequest','ApprovalDecision','ApprovalFinalizationPermit'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',n);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',n,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'erp_approval_%' OR p.proname IN('erp_apply_approval_command','erp_audit_approval_command','erp_guard_approval_audit')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
