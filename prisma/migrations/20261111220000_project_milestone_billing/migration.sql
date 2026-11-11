BEGIN;
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "projectMilestoneSourceId" UUID;

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "agreedPrice" DECIMAL(18,3) NOT NULL,
    "treatment" TEXT NOT NULL,
    "paymentTerms" VARCHAR(120),
    "paymentDueDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "createdBy" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneAction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "milestoneId" UUID NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectMilestoneAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneInvoiceSource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "milestoneId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerName" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "agreedPrice" DECIMAL(18,3) NOT NULL,
    "treatment" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(18,3) NOT NULL,
    "taxAmount" DECIMAL(18,3) NOT NULL,
    "vatProfileRevision" INTEGER,
    "paymentTerms" VARCHAR(120),
    "paymentDueDate" DATE,
    "replacesSourceId" UUID,
    "reason" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectMilestoneInvoiceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneInvoiceClaim" (
    "milestoneId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectMilestoneInvoiceClaim_pkey" PRIMARY KEY ("milestoneId")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneInvoiceRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectMilestoneInvoiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_requestId_key" ON "ProjectMilestone"("requestId");

-- CreateIndex
CREATE INDEX "ProjectMilestone_tenantId_companyId_projectId_createdAt_id_idx" ON "ProjectMilestone"("tenantId", "companyId", "projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_tenantId_companyId_id_key" ON "ProjectMilestone"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestone_tenantId_companyId_projectId_id_key" ON "ProjectMilestone"("tenantId", "companyId", "projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectMilestoneAction_tenantId_companyId_milestoneId_creat_idx" ON "ProjectMilestoneAction"("tenantId", "companyId", "milestoneId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestoneAction_tenantId_companyId_id_key" ON "ProjectMilestoneAction"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestoneInvoiceSource_replacesSourceId_key" ON "ProjectMilestoneInvoiceSource"("replacesSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestoneInvoiceSource_requestId_key" ON "ProjectMilestoneInvoiceSource"("requestId");

-- CreateIndex
CREATE INDEX "ProjectMilestoneInvoiceSource_tenantId_companyId_projectId__idx" ON "ProjectMilestoneInvoiceSource"("tenantId", "companyId", "projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestoneInvoiceSource_tenantId_companyId_id_key" ON "ProjectMilestoneInvoiceSource"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "ProjectMilestoneInvoiceClaim_sourceId_idx" ON "ProjectMilestoneInvoiceClaim"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMilestoneInvoiceRequest_tenantId_companyId_id_key" ON "ProjectMilestoneInvoiceRequest"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_projectMilestoneSourceId_key" ON "Invoice"("projectMilestoneSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_companyId_projectMilestoneSourceId_key" ON "Invoice"("tenantId", "companyId", "projectMilestoneSourceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_projectMilestoneSourceId_fkey" FOREIGN KEY ("tenantId", "companyId", "projectMilestoneSourceId") REFERENCES "ProjectMilestoneInvoiceSource"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" DROP CONSTRAINT invoice_exactly_one_source;
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_exactly_one_source CHECK(num_nonnulls("orderId","serviceSourceId","projectTimeSourceId","projectMilestoneSourceId")=1);
INSERT INTO "Permission"(key) VALUES ('project-milestone:read'),('project-milestone:manage'),('project-milestone:approve'),('project-milestone:generate') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('project-milestone:read'),('project-milestone:manage'),('project-milestone:approve'),('project-milestone:generate')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['ProjectMilestone','ProjectMilestoneAction','ProjectMilestoneInvoiceSource','ProjectMilestoneInvoiceClaim','ProjectMilestoneInvoiceRequest'] LOOP
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","projectId") REFERENCES "Project"("tenantId","companyId",id) ON DELETE RESTRICT',t);
 IF t<>'ProjectMilestoneInvoiceClaim' THEN
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT',t);
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT',t);
 END IF;
 END LOOP;
END $$;
ALTER TABLE "ProjectMilestone" ADD FOREIGN KEY ("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestone" ADD FOREIGN KEY ("tenantId","companyId","requestId") REFERENCES "ProjectMilestoneAction"("tenantId","companyId",id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProjectMilestone" ADD CHECK(status IN('DRAFT','COMPLETED','APPROVED','CANCELLED') AND sequence BETWEEN 0 AND 3 AND currency~'^[A-Z]{3}$' AND "agreedPrice">=0 AND treatment IN('STANDARD','ZERO','EXEMPT') AND length(btrim(description)) BETWEEN 3 AND 500 AND description!~'[[:cntrl:]]' AND ("paymentTerms" IS NULL)=("paymentDueDate" IS NULL) AND ("paymentTerms" IS NULL OR length(btrim("paymentTerms")) BETWEEN 3 AND 120 AND "paymentTerms"!~'[[:cntrl:]]') AND ("paymentDueDate" IS NULL OR "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'));
ALTER TABLE "ProjectMilestoneAction" ADD CHECK(outcome IN('COMMITTED','ABANDONED') AND jsonb_typeof(request)='object');
CREATE UNIQUE INDEX milestone_action_sequence ON "ProjectMilestoneAction"("milestoneId",(result->>'sequence')) WHERE outcome='COMMITTED';
CREATE FUNCTION erp_milestone_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Milestone request and source history immutable' USING ERRCODE='23514';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Milestone requires READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" FOR UPDATE;
 PERFORM id FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."creationTransaction":=txid_current()::text;RETURN NEW;
END $$;
CREATE FUNCTION erp_milestone_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p "Project"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Milestone history permanent' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE "tenantId"=NEW."tenantId" AND id=NEW."companyId" FOR UPDATE;
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 IF current_setting('transaction_isolation')<>'read committed' OR (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR p.status NOT IN('PLANNED','ACTIVE','ON_HOLD') THEN RAISE EXCEPTION 'Milestone operations require open scoped project' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
 IF NEW.status<>'DRAFT' OR NEW.sequence<>0 THEN RAISE EXCEPTION 'Milestone begins as draft definition' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."creationTransaction":=txid_current()::text;
 ELSE
 IF to_jsonb(NEW)-ARRAY['status','sequence'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','sequence'] OR NEW.sequence<>OLD.sequence+1 OR NOT (OLD.status='DRAFT' AND NEW.status IN('COMPLETED','CANCELLED') OR OLD.status='COMPLETED' AND NEW.status IN('APPROVED','CANCELLED') OR OLD.status='APPROVED' AND NEW.status='CANCELLED') OR EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceClaim" WHERE "milestoneId"=OLD.id) THEN RAISE EXCEPTION 'Only explicit unclaimed milestone progression or cancellation permitted' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER milestone_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectMilestone" FOR EACH ROW EXECUTE FUNCTION erp_milestone_guard();
CREATE FUNCTION erp_milestone_state_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ProjectMilestoneAction" a WHERE a."milestoneId"=NEW.id AND a.outcome='COMMITTED' AND a."creationTransaction"=txid_current()::text AND a.result=jsonb_build_object('kind','milestone','milestoneId',NEW.id,'status',NEW.status,'sequence',NEW.sequence)) THEN RAISE EXCEPTION 'Milestone state requires exact same-transaction immutable action' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER milestone_state_complete AFTER INSERT OR UPDATE ON "ProjectMilestone" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_milestone_state_complete();
CREATE FUNCTION erp_milestone_action_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p "Project"%ROWTYPE;m "ProjectMilestone"%ROWTYPE;c "Customer"%ROWTYPE;expected JSONB;k TEXT;permission TEXT;expected_status TEXT;seq INTEGER;
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 SELECT * INTO m FROM "ProjectMilestone" WHERE id=NEW."milestoneId";
 k:=NEW.request->>'kind';
 SELECT * INTO c FROM "Customer" WHERE id=CASE WHEN k='CREATE' THEN (NEW.request->>'customerId')::uuid ELSE m."customerId" END FOR SHARE;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'projectId',NEW."projectId",'expectedActorId',NEW."createdBy",'requestId',NEW.id,'milestoneId',NEW."milestoneId",'reason',NEW.request->'reason','kind',k);
 IF k='CREATE' THEN
 expected:=expected||jsonb_build_object('description',NEW.request->'description','customerId',NEW.request->'customerId','currency',NEW.request->'currency','agreedPrice',NEW.request->'agreedPrice','treatment',NEW.request->'treatment','paymentTerms',NEW.request->'paymentTerms','paymentDueDate',NEW.request->'paymentDueDate');seq:=0;expected_status:='DRAFT';
 IF jsonb_typeof(NEW.request->'description') IS DISTINCT FROM 'string' OR NEW.request->>'description' IS DISTINCT FROM btrim(NEW.request->>'description') OR length(btrim(NEW.request->>'description')) NOT BETWEEN 3 AND 500 OR NEW.request->>'description'~'[[:cntrl:]]' OR jsonb_typeof(NEW.request->'agreedPrice') IS DISTINCT FROM 'string' OR NEW.request->>'agreedPrice'!~'^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR NEW.request->>'currency' IS NULL OR NEW.request->>'currency'!~'^[A-Z]{3}$' OR NEW.request->>'treatment' IS NULL OR NEW.request->>'treatment' NOT IN('STANDARD','ZERO','EXEMPT') OR (NEW.request->'paymentTerms'='null'::jsonb) IS DISTINCT FROM (NEW.request->'paymentDueDate'='null'::jsonb) OR NEW.request->'paymentTerms'<>'null'::jsonb AND (jsonb_typeof(NEW.request->'paymentTerms') IS DISTINCT FROM 'string' OR NEW.request->>'paymentTerms' IS DISTINCT FROM btrim(NEW.request->>'paymentTerms') OR jsonb_typeof(NEW.request->'paymentDueDate') IS DISTINCT FROM 'string' OR length(btrim(NEW.request->>'paymentTerms')) NOT BETWEEN 3 AND 120 OR NEW.request->>'paymentTerms'~'[[:cntrl:]]' OR NEW.request->>'paymentDueDate'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (NEW.request->>'paymentDueDate')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31') THEN RAISE EXCEPTION 'Explicit exact commercial agreement required' USING ERRCODE='23514';END IF;
 ELSE
 expected:=expected||jsonb_build_object('expectedSequence',NEW.request->'expectedSequence');
 IF k IS NULL OR k NOT IN('COMPLETE','APPROVE','CANCEL') OR jsonb_typeof(NEW.request->'expectedSequence') IS DISTINCT FROM 'number' OR NEW.request->>'expectedSequence'!~'^[0-2]$' THEN RAISE EXCEPTION 'Explicit milestone transition required' USING ERRCODE='23514';END IF;
 seq:=(NEW.request->>'expectedSequence')::integer+1;expected_status:=CASE k WHEN 'COMPLETE' THEN 'COMPLETED' WHEN 'APPROVE' THEN 'APPROVED' ELSE 'CANCELLED' END;
 END IF;
 IF NEW.request IS DISTINCT FROM expected OR jsonb_typeof(NEW.request->'reason') IS DISTINCT FROM 'string' OR NEW.request->>'reason' IS DISTINCT FROM btrim(NEW.request->>'reason') OR length(btrim(coalesce(NEW.request->>'reason',''))) NOT BETWEEN 3 AND 300 OR NEW.request->>'reason'~'[[:cntrl:]]' OR p.id IS NULL OR c.id IS NULL OR (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR (c."tenantId",c."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId" THEN RAISE EXCEPTION 'Canonical current-scoped milestone action required' USING ERRCODE='23514';END IF;
 FOREACH permission IN ARRAY ARRAY['project:read','project-milestone:read',CASE k WHEN 'APPROVE' THEN 'project-milestone:approve' ELSE 'project-milestone:manage' END] LOOP
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current milestone action permission required' USING ERRCODE='23514';END IF;END LOOP;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Customer read required' USING ERRCODE='23514';END IF;
 IF NEW.outcome='ABANDONED' THEN
 IF NEW.result<>jsonb_build_object('kind','abandoned') OR EXISTS(SELECT 1 FROM "ProjectMilestone" WHERE "requestId"=NEW.id) THEN RAISE EXCEPTION 'Abandonment cannot create milestone' USING ERRCODE='23514';END IF;
 ELSE
 IF p.status NOT IN('PLANNED','ACTIVE','ON_HOLD') OR c."archivedAt" IS NOT NULL OR m.id IS NULL OR (m."tenantId",m."companyId",m."branchId",m."projectId",m."customerId",m.status,m.sequence) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",c.id,expected_status,seq) OR NEW.result IS DISTINCT FROM jsonb_build_object('kind','milestone','milestoneId',m.id,'status',expected_status,'sequence',seq) THEN RAISE EXCEPTION 'Milestone transition result mismatch' USING ERRCODE='23514';END IF;
 IF k='CREATE' AND (m."requestId"<>NEW.id OR m."createdBy"<>NEW."createdBy" OR m."creationTransaction"<>NEW."creationTransaction" OR (m.description,m.currency,m."agreedPrice",m.treatment,m."paymentTerms",m."paymentDueDate") IS DISTINCT FROM (NEW.request->>'description',NEW.request->>'currency',(NEW.request->>'agreedPrice')::numeric,NEW.request->>'treatment',NEW.request->>'paymentTerms',(NEW.request->>'paymentDueDate')::date)) THEN RAISE EXCEPTION 'Milestone commercial definition differs from request' USING ERRCODE='23514';END IF;
 IF k<>'CREATE' AND NOT EXISTS(SELECT 1 FROM "ProjectMilestoneAction" a WHERE a."milestoneId"=m.id AND a.outcome='COMMITTED' AND (a.result->>'sequence')::integer=seq-1 AND a.result->>'status'=CASE k WHEN 'COMPLETE' THEN 'DRAFT' WHEN 'APPROVE' THEN 'COMPLETED' ELSE a.result->>'status' END AND a.result->>'status'<>'CANCELLED') THEN RAISE EXCEPTION 'Prior milestone review action required' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER milestone_action_complete AFTER INSERT ON "ProjectMilestoneAction" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_milestone_action_complete();
CREATE FUNCTION erp_milestone_action_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'project-milestone.'||lower(NEW.outcome),'ProjectMilestoneAction',NEW.id::text,jsonb_build_object('projectId',NEW."projectId",'milestoneId',NEW."milestoneId",'kind',NEW.request->>'kind','outcome',NEW.outcome),NEW."createdAt");RETURN NEW;
END $$;
CREATE TRIGGER milestone_action_audit AFTER INSERT ON "ProjectMilestoneAction" FOR EACH ROW EXECUTE FUNCTION erp_milestone_action_audit();
ALTER TABLE "ProjectMilestoneInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestoneInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","requestId") REFERENCES "ProjectMilestoneInvoiceRequest"("tenantId","companyId",id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProjectMilestoneInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","replacesSourceId") REFERENCES "ProjectMilestoneInvoiceSource"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestoneInvoiceClaim" ADD FOREIGN KEY ("tenantId","companyId","projectId","milestoneId") REFERENCES "ProjectMilestone"("tenantId","companyId","projectId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestoneInvoiceClaim" ADD FOREIGN KEY ("tenantId","companyId","sourceId") REFERENCES "ProjectMilestoneInvoiceSource"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestoneInvoiceRequest" ADD CHECK(outcome IN ('COMMITTED','ABANDONED') AND jsonb_typeof(request)='object');
ALTER TABLE "ProjectMilestoneInvoiceSource" ADD CHECK(currency~'^[A-Z]{3}$' AND subtotal>=0 AND "taxAmount">=0 AND length(btrim(reason)) BETWEEN 3 AND 300 AND ("paymentTerms" IS NULL OR length(btrim("paymentTerms")) BETWEEN 3 AND 120) AND ("paymentDueDate" IS NULL OR "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'));
CREATE FUNCTION erp_milestone_invoice_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Project milestone invoice history and claims are immutable' USING ERRCODE='23514';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Milestone billing requires READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='ProjectMilestoneInvoiceSource' THEN PERFORM id FROM "Customer" WHERE id=(to_jsonb(NEW)->>'customerId')::uuid FOR SHARE;END IF;
 PERFORM id FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."creationTransaction":=txid_current()::text;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['ProjectMilestoneInvoiceSource','ProjectMilestoneInvoiceClaim','ProjectMilestoneInvoiceRequest'] LOOP
 EXECUTE format('CREATE TRIGGER milestone_invoice_history BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_history()',t);
END LOOP;END $$;
CREATE FUNCTION erp_milestone_invoice_reversed(invoice_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Invoice" i WHERE i.id=invoice_id AND i.status='VOID')
 AND NOT EXISTS(SELECT 1 FROM "JournalEntry" j WHERE (j.number=erp_billing_invoice_journal(invoice_id) OR EXISTS(SELECT 1 FROM "AuditLog" a WHERE a.entity='Invoice' AND a."entityId"=invoice_id::text AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=j.id::text)) AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id))
 AND NOT EXISTS(SELECT 1 FROM "CustomerSettlement" cs JOIN "JournalEntry" j ON j.id=cs."entryId" WHERE cs."invoiceId"=invoice_id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id));
$$;
CREATE FUNCTION erp_milestone_invoice_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source "ProjectMilestoneInvoiceSource"%ROWTYPE;
BEGIN
 -- Other source lifecycle guards retain their existing contract.
 IF NEW."projectMilestoneSourceId" IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO source FROM "ProjectMilestoneInvoiceSource" WHERE id=NEW."projectMilestoneSourceId";
 PERFORM id FROM "Project" WHERE id=source."projectId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
 IF NEW.status<>'DRAFT' OR NEW."issuedAt" IS NOT NULL OR NEW."voidedAt" IS NOT NULL OR NEW."voidReason" IS NOT NULL THEN RAISE EXCEPTION 'Project invoices begin as genuine drafts' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.status=OLD.status THEN
 IF (NEW."issuedAt",NEW."voidedAt",NEW."voidReason") IS DISTINCT FROM (OLD."issuedAt",OLD."voidedAt",OLD."voidReason") THEN RAISE EXCEPTION 'Invoice lifecycle dates immutable without transition' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF OLD.status='VOID' OR NEW.status='DRAFT' THEN RAISE EXCEPTION 'VOID project invoice is terminal; use explicit replacement' USING ERRCODE='23514';END IF;
 IF NEW.status='ISSUED' THEN
 IF OLD.status<>'DRAFT' OR NEW."issuedAt" IS NULL OR NEW."voidedAt" IS NOT NULL OR NEW."voidReason" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "ProjectMilestone" m WHERE m.id=source."milestoneId" AND m.status='APPROVED' AND m.sequence=2) THEN RAISE EXCEPTION 'Issue requires still-approved original milestone' USING ERRCODE='23514';END IF;
 ELSE
 IF NEW."voidedAt" IS NULL OR length(btrim(coalesce(NEW."voidReason",'')))<3 OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR EXISTS(SELECT 1 FROM "JournalEntry" j WHERE (j.number=erp_billing_invoice_journal(OLD.id) OR EXISTS(SELECT 1 FROM "AuditLog" a WHERE a.entity='Invoice' AND a."entityId"=OLD.id::text AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=j.id::text)) AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id)) OR EXISTS(SELECT 1 FROM "CustomerSettlement" cs JOIN "JournalEntry" j ON j.id=cs."entryId" WHERE cs."invoiceId"=OLD.id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id)) THEN RAISE EXCEPTION 'Void requires reversed financial dependencies and reason' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER milestone_invoice_status_guard BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_status_guard();
CREATE FUNCTION erp_milestone_invoice_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p "Project"%ROWTYPE;c "Customer"%ROWTYPE;r "ProjectMilestoneInvoiceRequest"%ROWTYPE;i "Invoice"%ROWTYPE;v "CompanyVatProfile"%ROWTYPE;old_s "ProjectMilestoneInvoiceSource"%ROWTYPE;m "ProjectMilestone"%ROWTYPE;price_lines JSONB:='[]';prices JSONB;taxable BOOLEAN;net NUMERIC;permission TEXT;prior UUID;root_id UUID;visited UUID[]:=ARRAY[]::UUID[];
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 SELECT * INTO c FROM "Customer" WHERE id=NEW."customerId" FOR SHARE;
 SELECT * INTO r FROM "ProjectMilestoneInvoiceRequest" WHERE id=NEW."requestId";
 SELECT * INTO i FROM "Invoice" WHERE "projectMilestoneSourceId"=NEW.id;
 SELECT * INTO v FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 taxable:=coalesce(v.enabled AND v."effectiveFrom"<=NEW."createdAt"::date,false);
 IF p.id IS NULL OR c.id IS NULL OR r.id IS NULL OR i.id IS NULL OR r.outcome<>'COMMITTED' OR r."creationTransaction"<>NEW."creationTransaction" OR i."creationTransaction"<>NEW."creationTransaction" OR NEW."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Project invoice requires same-transaction request and draft invoice' USING ERRCODE='23514';END IF;
 IF (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR p.status='CANCELLED' AND NEW."replacesSourceId" IS NULL OR c."archivedAt" IS NOT NULL OR (c."tenantId",c."companyId",c."displayName") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."customerName") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId" OR (r."tenantId",r."companyId",r."branchId",r."projectId",r."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",NEW."createdBy") THEN RAISE EXCEPTION 'Current project/customer scope mismatch' USING ERRCODE='23514';END IF;
 FOREACH permission IN ARRAY ARRAY['project:read','project-milestone:read','project-milestone:generate','project-billing:read','project-billing:manage','invoice:read','invoice:create'] LOOP
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current milestone invoice permission required: %',permission USING ERRCODE='23514';END IF;END LOOP;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Current customer read required' USING ERRCODE='23514';END IF;
 IF (NEW."customerId",NEW.currency,NEW."paymentTerms",NEW."paymentDueDate",NEW."replacesSourceId",NEW.reason) IS DISTINCT FROM ((r.request->>'customerId')::uuid,r.request->>'currency',r.request->>'paymentTerms',(r.request->>'paymentDueDate')::date,(r.request->>'replacesSourceId')::uuid,r.request->>'reason') THEN RAISE EXCEPTION 'Milestone source differs from explicit request' USING ERRCODE='23514';END IF;
 SELECT * INTO m FROM "ProjectMilestone" WHERE id=NEW."milestoneId";
 IF m.id IS NULL OR (m."tenantId",m."companyId",m."branchId",m."projectId",m."customerId",m.currency,m.description,m.status,m.sequence) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",NEW."customerId",NEW.currency,NEW.description,'APPROVED',2) OR (r.request->>'milestoneId')::uuid IS DISTINCT FROM m.id OR (r.request->>'expectedSequence')::integer IS DISTINCT FROM 2 OR (NEW."agreedPrice",NEW.treatment) IS DISTINCT FROM ((r.request->>'agreedPrice')::numeric,r.request->>'treatment') THEN RAISE EXCEPTION 'Current approved original milestone entitlement required' USING ERRCODE='23514';END IF;
 IF NEW."replacesSourceId" IS NULL AND (m."agreedPrice",m.treatment,m."paymentTerms",m."paymentDueDate") IS DISTINCT FROM (NEW."agreedPrice",NEW.treatment,NEW."paymentTerms",NEW."paymentDueDate") THEN RAISE EXCEPTION 'Original invoice must preserve approved agreement' USING ERRCODE='23514';END IF;
 price_lines:=jsonb_build_array(jsonb_build_object('description',m.description,'quantity',1,'unitPrice',to_char(NEW."agreedPrice",'FM999999999999999990.000'),'treatment',NEW.treatment));
 IF r.request->>'previewHash' IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('actorId',NEW."createdBy",'projectId',p.id,'projectName',p.name,'projectStatus',p.status,'customerId',c.id,'customerName',c."displayName",'customerBranchId',c."branchId",'milestoneId',m.id,'description',m.description,'sequence',m.sequence,'agreedPrice',to_char(NEW."agreedPrice",'FM999999999999999990.000'),'treatment',NEW.treatment,'currency',NEW.currency,'paymentTerms',NEW."paymentTerms",'paymentDueDate',CASE WHEN NEW."paymentDueDate" IS NULL THEN NULL ELSE to_char(NEW."paymentDueDate",'YYYY-MM-DD') END,'replacesSourceId',NEW."replacesSourceId",'invoiceDate',to_char(NEW."createdAt",'YYYY-MM-DD'),'vatProfileRevision',v.revision,'vatProfile',CASE WHEN v."companyId" IS NULL THEN NULL ELSE to_jsonb(v) END)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Current canonical milestone, customer, price and VAT fingerprint required' USING ERRCODE='23514';END IF;
 prices:=erp_billing_prices(price_lines,taxable);
 IF NEW.lines IS DISTINCT FROM prices->'lines' OR NEW.subtotal IS DISTINCT FROM (prices->>'subtotal')::numeric OR NEW."taxAmount" IS DISTINCT FROM (prices->>'taxAmount')::numeric OR NEW."vatProfileRevision" IS DISTINCT FROM (CASE WHEN taxable THEN v.revision ELSE NULL END) OR taxable AND NEW.currency<>'OMR' THEN RAISE EXCEPTION 'Exact milestone prices and invoice-date tax required' USING ERRCODE='23514';END IF;
 IF NEW."replacesSourceId" IS NOT NULL THEN
 SELECT * INTO old_s FROM "ProjectMilestoneInvoiceSource" WHERE id=NEW."replacesSourceId";
 SELECT id INTO prior FROM "Invoice" WHERE "projectMilestoneSourceId"=old_s.id FOR UPDATE;
 IF old_s.id IS NULL OR NOT erp_milestone_invoice_reversed(prior) OR (old_s."tenantId",old_s."companyId",old_s."branchId",old_s."projectId",old_s."customerId",old_s.currency) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",NEW."customerId",NEW.currency) OR old_s."milestoneId" IS DISTINCT FROM NEW."milestoneId" THEN RAISE EXCEPTION 'Explicit replacement needs reversed VOID source and same entitlements' USING ERRCODE='23514';END IF;
 root_id:=old_s.id;
 LOOP
 IF root_id=ANY(visited) THEN RAISE EXCEPTION 'Cyclic correction source' USING ERRCODE='23514';END IF;visited:=array_append(visited,root_id);
 SELECT "replacesSourceId" INTO prior FROM "ProjectMilestoneInvoiceSource" WHERE id=root_id;
 EXIT WHEN prior IS NULL;root_id:=prior;
 END LOOP;
 ELSE root_id:=NEW.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceClaim" cl WHERE cl."milestoneId"=NEW."milestoneId" AND cl."sourceId"=root_id AND cl."projectId"=NEW."projectId") THEN RAISE EXCEPTION 'Permanent unique milestone claim required' USING ERRCODE='23514';END IF;
 IF i.number IS DISTINCT FROM 'PM-'||substr(erp_billing_invoice_journal(NEW.id),6) OR i.status<>'DRAFT' OR (i."tenantId",i."companyId",i."branchId",i."customerId",i."customerName",i.currency,i.subtotal,i."paymentTerms",i."paymentDueDate",i."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."customerName",NEW.currency,NEW.subtotal,NEW."paymentTerms",NEW."paymentDueDate",NEW."createdBy") THEN RAISE EXCEPTION 'Draft invoice must match project source' USING ERRCODE='23514';END IF;
 IF (SELECT coalesce(jsonb_agg(jsonb_build_object('position',l.position,'description',l.description,'quantity',l.quantity,'unitPrice',to_char(l."unitPrice",'FM999999999999999990.000'),'amount',to_char(l.amount,'FM999999999999999990.000')) ORDER BY l.position),'[]'::jsonb) FROM "InvoiceLine" l WHERE l."invoiceId"=i.id) IS DISTINCT FROM (SELECT jsonb_agg(x-ARRAY['treatment','tax'] ORDER BY (x->>'position')::integer) FROM jsonb_array_elements(NEW.lines) x) THEN RAISE EXCEPTION 'Milestone invoice line parity required' USING ERRCODE='23514';END IF;
 IF taxable THEN
 IF NOT EXISTS(SELECT 1 FROM "InvoiceVat" iv WHERE iv."invoiceId"=i.id AND iv."taxAmount"=NEW."taxAmount" AND iv.details=(SELECT jsonb_agg(jsonb_build_object('position',(x->>'position')::integer,'treatment',x->>'treatment','net',x->>'amount','tax',x->>'tax') ORDER BY (x->>'position')::integer) FROM jsonb_array_elements(NEW.lines) x)) THEN RAISE EXCEPTION 'Milestone VAT classification mismatch' USING ERRCODE='23514';END IF;
 ELSIF EXISTS(SELECT 1 FROM "InvoiceVat" WHERE "invoiceId"=i.id) THEN RAISE EXCEPTION 'Inactive VAT cannot have tax record' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectInvoiceLink" l WHERE l."invoiceId"=i.id AND l."projectId"=NEW."projectId" AND l."createdBy"=NEW."createdBy" AND l.note=NEW.reason AND l."creationTransaction"=NEW."creationTransaction" AND l."unlinkedAt" IS NULL) THEN RAISE EXCEPTION 'Immutable automatic project link required' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity='Invoice' AND a.action='invoice.created' AND a."entityId"=i.id::text AND a.metadata=jsonb_build_object('projectMilestoneSourceId',NEW.id,'projectId',NEW."projectId",'requestId',NEW."requestId")) THEN RAISE EXCEPTION 'Request-generated invoice creation audit required' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER milestone_invoice_complete AFTER INSERT ON "ProjectMilestoneInvoiceSource" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_complete();
CREATE FUNCTION erp_milestone_invoice_claim_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceSource" s WHERE s.id=NEW."sourceId" AND s."projectId"=NEW."projectId" AND s."creationTransaction"=NEW."creationTransaction" AND s."replacesSourceId" IS NULL AND s."milestoneId"=NEW."milestoneId") THEN RAISE EXCEPTION 'Claim must belong to same-transaction original source' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER milestone_invoice_claim_complete AFTER INSERT ON "ProjectMilestoneInvoiceClaim" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_claim_complete();
CREATE FUNCTION erp_milestone_invoice_request_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c "Customer"%ROWTYPE;p "Project"%ROWTYPE;s "ProjectMilestoneInvoiceSource"%ROWTYPE;i "Invoice"%ROWTYPE;expected JSONB;permission TEXT;chosen JSONB;
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 SELECT * INTO c FROM "Customer" WHERE id=(NEW.request->>'customerId')::uuid FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('project-milestone:'||NEW.id::text,0));
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'projectId',NEW."projectId",'expectedActorId',NEW."createdBy",'customerId',NEW.request->'customerId','currency',NEW.request->'currency','milestoneId',NEW.request->'milestoneId','expectedSequence',NEW.request->'expectedSequence','agreedPrice',NEW.request->'agreedPrice','treatment',NEW.request->'treatment','paymentTerms',NEW.request->'paymentTerms','paymentDueDate',NEW.request->'paymentDueDate','replacesSourceId',NEW.request->'replacesSourceId','requestId',NEW.id,'previewHash',NEW.request->'previewHash','reason',NEW.request->'reason');
 IF NEW.request IS DISTINCT FROM expected OR NEW.request->>'previewHash' IS NULL OR NEW.request->>'previewHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.request->'reason') IS DISTINCT FROM 'string' OR NEW.request->>'reason' IS DISTINCT FROM btrim(NEW.request->>'reason') OR length(btrim(NEW.request->>'reason')) NOT BETWEEN 3 AND 300 OR (NEW.request->>'reason')~'[[:cntrl:]]' OR p.id IS NULL OR c.id IS NULL OR (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR (c."tenantId",c."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId" THEN RAISE EXCEPTION 'Canonical actor-bound request with current scope required' USING ERRCODE='23514';END IF;
 FOREACH permission IN ARRAY ARRAY['project:read','project-milestone:read','project-milestone:generate','project-billing:read','project-billing:manage','invoice:read','invoice:create'] LOOP
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current request permission required' USING ERRCODE='23514';END IF;END LOOP;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Customer authorization required' USING ERRCODE='23514';END IF;
 IF (NEW.request->'paymentTerms'='null'::jsonb) IS DISTINCT FROM (NEW.request->'paymentDueDate'='null'::jsonb) OR jsonb_typeof(NEW.request->'currency') IS DISTINCT FROM 'string' OR NEW.request->>'currency' !~ '^[A-Z]{3}$' OR (NEW.request->'paymentTerms'<>'null'::jsonb AND (jsonb_typeof(NEW.request->'paymentTerms') IS DISTINCT FROM 'string' OR NEW.request->>'paymentTerms' IS DISTINCT FROM btrim(NEW.request->>'paymentTerms') OR length(btrim(NEW.request->>'paymentTerms')) NOT BETWEEN 3 AND 120 OR NEW.request->>'paymentTerms' ~ '[[:cntrl:]]')) OR (NEW.request->'paymentDueDate'<>'null'::jsonb AND (jsonb_typeof(NEW.request->'paymentDueDate') IS DISTINCT FROM 'string' OR NEW.request->>'paymentDueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (NEW.request->>'paymentDueDate')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')) OR (NEW.request->'replacesSourceId'<>'null'::jsonb AND (NEW.request->>'replacesSourceId')::uuid IS NULL) THEN RAISE EXCEPTION 'Explicit valid currency and terms required' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(NEW.request->'agreedPrice') IS DISTINCT FROM 'string' OR NEW.request->>'agreedPrice'!~'^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR NEW.request->'expectedSequence' IS DISTINCT FROM '2'::jsonb OR (NEW.request->>'milestoneId')::uuid IS NULL OR NEW.request->>'treatment' IS NULL OR NEW.request->>'treatment' NOT IN('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Exact milestone request fields required' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM "ProjectMilestoneInvoiceSource" WHERE "requestId"=NEW.id;
 IF NEW.outcome='ABANDONED' THEN
 IF s.id IS NOT NULL OR NEW.result<>jsonb_build_object('kind','abandoned') THEN RAISE EXCEPTION 'Abandoned request cannot produce a source' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO i FROM "Invoice" WHERE "projectMilestoneSourceId"=s.id;
 IF s.id IS NULL OR i.id IS NULL OR NEW.result IS DISTINCT FROM jsonb_build_object('kind','invoice','projectMilestoneSourceId',s.id,'invoice',jsonb_build_object('id',i.id,'number',i.number,'status','DRAFT')) THEN RAISE EXCEPTION 'Exact committed milestone invoice receipt required' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER milestone_invoice_request_complete AFTER INSERT ON "ProjectMilestoneInvoiceRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_request_complete();
CREATE FUNCTION erp_milestone_invoice_request_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'project-milestone.'||lower(NEW.outcome),'ProjectMilestoneInvoiceRequest',NEW.id::text,jsonb_build_object('projectId',NEW."projectId",'outcome',NEW.outcome),NEW."createdAt");
 IF NEW.outcome='COMMITTED' THEN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") SELECT gen_random_uuid(),NEW."tenantId",NEW."createdBy",'invoice.created','Invoice',i.id::text,jsonb_build_object('projectMilestoneSourceId',s.id,'projectId',NEW."projectId",'requestId',NEW.id),NEW."createdAt" FROM "ProjectMilestoneInvoiceSource" s JOIN "Invoice" i ON i."projectMilestoneSourceId"=s.id WHERE s."requestId"=NEW.id;
 END IF;
 RETURN NEW;END $$;
CREATE TRIGGER milestone_invoice_request_audit AFTER INSERT ON "ProjectMilestoneInvoiceRequest" FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_request_audit();
CREATE FUNCTION erp_milestone_invoice_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND (OLD.entity IN('ProjectMilestoneInvoiceRequest','ProjectMilestoneAction') OR OLD.entity='Invoice' AND OLD.action='invoice.created' AND (OLD.metadata ? 'projectMilestoneSourceId' OR EXISTS(SELECT 1 FROM "Invoice" WHERE id::text=OLD."entityId" AND "projectMilestoneSourceId" IS NOT NULL)) OR OLD.entity='ProjectInvoiceLink' AND EXISTS(SELECT 1 FROM "ProjectInvoiceLink" l JOIN "Invoice" i ON i.id=l."invoiceId" WHERE l.id::text=OLD."entityId" AND i."projectMilestoneSourceId" IS NOT NULL)) THEN RAISE EXCEPTION 'Milestone invoice audit immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF (NEW.entity IN('ProjectMilestoneInvoiceRequest','ProjectMilestoneAction') OR NEW.entity='Invoice' AND NEW.action='invoice.created' AND (NEW.metadata ? 'projectMilestoneSourceId' OR EXISTS(SELECT 1 FROM "Invoice" WHERE id::text=NEW."entityId" AND "projectMilestoneSourceId" IS NOT NULL))) AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Milestone invoice audit is request generated' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER milestone_invoice_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_audit_guard();

ALTER TABLE "ProjectMilestoneInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","projectId","milestoneId") REFERENCES "ProjectMilestone"("tenantId","companyId","projectId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectMilestoneInvoiceSource" ADD CHECK ("agreedPrice">=0 AND treatment IN('STANDARD','ZERO','EXEMPT') AND ("paymentTerms" IS NULL)=("paymentDueDate" IS NULL));
CREATE OR REPLACE FUNCTION erp_invoice_source_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s "ServiceInvoiceSource"%ROWTYPE;p "ProjectTimeInvoiceSource"%ROWTYPE;m "ProjectMilestoneInvoiceSource"%ROWTYPE;
BEGIN
 IF NEW."orderId" IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM "SalesOrder" o WHERE o.id=NEW."orderId" AND o."tenantId"=NEW."tenantId" AND o."companyId"=NEW."companyId" AND o.status='COMPLETED') THEN RAISE EXCEPTION 'New order invoice requires completed real sales order' USING ERRCODE='23514';END IF;
 ELSIF NEW."projectMilestoneSourceId" IS NOT NULL THEN
 SELECT * INTO m FROM "ProjectMilestoneInvoiceSource" WHERE id=NEW."projectMilestoneSourceId";
 IF m.id IS NULL OR m."creationTransaction"<>txid_current()::text OR NEW.status<>'DRAFT' OR NEW."creationTransaction"<>txid_current()::text OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId") IS DISTINCT FROM (m."tenantId",m."companyId",m."branchId",m."customerId") THEN RAISE EXCEPTION 'New milestone invoice requires same-transaction source' USING ERRCODE='23514';END IF;
 NEW."createdAt":=m."createdAt";
 ELSIF NEW."projectTimeSourceId" IS NOT NULL THEN
 SELECT * INTO p FROM "ProjectTimeInvoiceSource" WHERE id=NEW."projectTimeSourceId";
 IF p.id IS NULL OR p."creationTransaction"<>txid_current()::text OR NEW.status<>'DRAFT' OR NEW."creationTransaction"<>txid_current()::text OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId") IS DISTINCT FROM (p."tenantId",p."companyId",p."branchId",p."customerId") THEN RAISE EXCEPTION 'New project invoice requires same-transaction time source' USING ERRCODE='23514';END IF;
 NEW."createdAt":=p."createdAt";
 ELSE
 SELECT * INTO s FROM "ServiceInvoiceSource" WHERE id=NEW."serviceSourceId";
 IF s.id IS NULL OR s."creationTransaction"<>txid_current()::text OR NEW.status<>'DRAFT' OR NEW."creationTransaction"<>txid_current()::text OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId") IS DISTINCT FROM (s."tenantId",s."companyId",s."branchId",s."customerId") THEN RAISE EXCEPTION 'New service invoice requires same-transaction configured source' USING ERRCODE='23514';END IF;
 NEW."createdAt":=s."createdAt";
 END IF;RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION erp_project_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent RECORD; source RECORD; actor UUID;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Project invoice history cannot be deleted' USING ERRCODE='23514';END IF;
 SELECT * INTO parent FROM "Project" WHERE id=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION 'Project is closed or unavailable for invoice changes' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF source.id IS NULL OR (parent."branchId" IS NOT NULL AND source."branchId" IS DISTINCT FROM parent."branchId") THEN RAISE EXCEPTION 'Invoice is outside project scope' USING ERRCODE='23514';END IF;
 IF parent.status NOT IN('PLANNED','ACTIVE','ON_HOLD') AND NOT (TG_OP='INSERT' AND (source."projectTimeSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s WHERE s.id=source."projectTimeSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text AND (parent.status='COMPLETED' OR parent.status='CANCELLED' AND s."replacesSourceId" IS NOT NULL)) OR source."projectMilestoneSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceSource" s WHERE s.id=source."projectMilestoneSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text AND (parent.status='COMPLETED' OR parent.status='CANCELLED' AND s."replacesSourceId" IS NOT NULL)))) THEN RAISE EXCEPTION 'Closed projects allow only authorized generated project billing, not manual reassignment' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NOT (source.status='ISSUED' OR source.status='DRAFT' AND (source."projectTimeSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s WHERE s.id=source."projectTimeSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text) OR source."projectMilestoneSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceSource" s WHERE s.id=source."projectMilestoneSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text))) OR NEW."unlinkRequestId" IS NOT NULL OR NEW."unlinkedBy" IS NOT NULL OR NEW."unlinkedAt" IS NOT NULL OR NEW."unlinkReason" IS NOT NULL OR NEW."unlinkTransaction" IS NOT NULL THEN RAISE EXCEPTION 'Link requires an issued invoice and active initial state' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM "ProjectInvoiceLink" WHERE "invoiceId"=source.id AND "unlinkedAt" IS NULL) THEN RAISE EXCEPTION 'Invoice already belongs to an active project link' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM "ProjectInvoiceLink" WHERE "tenantId"=NEW."tenantId" AND "projectId"=NEW."projectId")>=1000 THEN RAISE EXCEPTION 'Project invoice history limit reached' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();NEW."creationTransaction":=txid_current()::text;actor:=NEW."createdBy";
 ELSE
  IF source."projectTimeSourceId" IS NOT NULL OR source."projectMilestoneSourceId" IS NOT NULL THEN RAISE EXCEPTION 'Generated project invoice link is permanent' USING ERRCODE='23514';END IF;
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."projectId",NEW."invoiceId",NEW.note,NEW."createdBy",NEW."createdAt",NEW."creationTransaction") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."projectId",OLD."invoiceId",OLD.note,OLD."createdBy",OLD."createdAt",OLD."creationTransaction") OR OLD."unlinkedAt" IS NOT NULL OR NEW."unlinkRequestId" IS NULL OR NEW."unlinkedBy" IS NULL OR NEW."unlinkReason" IS NULL THEN RAISE EXCEPTION 'Only one permanent project invoice unlink is allowed' USING ERRCODE='23514';END IF;
  NEW."unlinkedAt":=clock_timestamp();NEW."unlinkTransaction":=txid_current()::text;actor:=NEW."unlinkedBy";
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Project billing requires an active scoped actor' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
-- Trusted-backend source hardening: public project APIs never expose scope moves.
-- Retain even cancelled/unclaimed agreements within their original project scope.
CREATE FUNCTION erp_milestone_project_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "ProjectMilestone" WHERE "projectId"=OLD.id) THEN RAISE EXCEPTION 'Milestone project scope immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER milestone_project_scope BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION erp_milestone_project_scope();
CREATE FUNCTION erp_milestone_invoice_customer_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND (EXISTS(SELECT 1 FROM "ProjectMilestoneInvoiceSource" WHERE "customerId"=OLD.id) OR EXISTS(SELECT 1 FROM "ProjectMilestone" WHERE "customerId"=OLD.id)) THEN RAISE EXCEPTION 'Milestone customer scope immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER milestone_invoice_customer_scope BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION erp_milestone_invoice_customer_scope();

DO $$ DECLARE t TEXT;r TEXT;f TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['ProjectMilestone','ProjectMilestoneAction','ProjectMilestoneInvoiceSource','ProjectMilestoneInvoiceClaim','ProjectMilestoneInvoiceRequest'] LOOP
 IF t IN('ProjectMilestoneAction') THEN EXECUTE format('CREATE TRIGGER milestone_history BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION erp_milestone_history()',t);END IF;
 EXECUTE format('CREATE TRIGGER milestone_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate()',t);
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'erp_milestone_%' OR proname IN('erp_invoice_source_insert','erp_project_invoice_guard')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
