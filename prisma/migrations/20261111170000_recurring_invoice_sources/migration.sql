BEGIN;
-- Publish nullable order sources and all service-source protections atomically.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "serviceSourceId" UUID,
ALTER COLUMN "orderId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BillingPlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPlanRevision" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "planId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "BillingPlanRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "customerId" UUID NOT NULL,
    "manualSubscriptionId" UUID,
    "anchor" DATE NOT NULL,
    "cadence" JSONB NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscriptionRevision" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "subscriptionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effectivePeriod" INTEGER NOT NULL,
    "planRevisionId" UUID NOT NULL,
    "horizon" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "archived" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "BillingSubscriptionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "action" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "BillingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceInvoiceSource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "customerId" UUID NOT NULL,
    "customerName" TEXT NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "subscriptionRevisionId" UUID NOT NULL,
    "planRevisionId" UUID NOT NULL,
    "periodIndex" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "correctionIndex" INTEGER NOT NULL DEFAULT 0,
    "replacesSourceId" UUID,
    "currency" VARCHAR(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(18,3) NOT NULL,
    "taxAmount" DECIMAL(18,3) NOT NULL,
    "vatProfileRevision" INTEGER,
    "paymentTerms" VARCHAR(120),
    "paymentDueDate" DATE,
    "reason" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ServiceInvoiceSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingPlan_tenantId_companyId_branchId_idx" ON "BillingPlan"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlan_tenantId_companyId_id_key" ON "BillingPlan"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlanRevision_requestId_key" ON "BillingPlanRevision"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlanRevision_planId_version_key" ON "BillingPlanRevision"("planId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPlanRevision_tenantId_companyId_id_key" ON "BillingPlanRevision"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "BillingSubscription_tenantId_companyId_branchId_idx" ON "BillingSubscription"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_tenantId_companyId_id_key" ON "BillingSubscription"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscriptionRevision_requestId_key" ON "BillingSubscriptionRevision"("requestId");

-- CreateIndex
CREATE INDEX "BillingSubscriptionRevision_subscriptionId_effectivePeriod__idx" ON "BillingSubscriptionRevision"("subscriptionId", "effectivePeriod", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscriptionRevision_subscriptionId_version_key" ON "BillingSubscriptionRevision"("subscriptionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscriptionRevision_tenantId_companyId_id_key" ON "BillingSubscriptionRevision"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "BillingRequest_tenantId_companyId_branchId_idx" ON "BillingRequest"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingRequest_tenantId_companyId_id_key" ON "BillingRequest"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInvoiceSource_replacesSourceId_key" ON "ServiceInvoiceSource"("replacesSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInvoiceSource_requestId_key" ON "ServiceInvoiceSource"("requestId");

-- CreateIndex
CREATE INDEX "ServiceInvoiceSource_tenantId_companyId_branchId_idx" ON "ServiceInvoiceSource"("tenantId", "companyId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInvoiceSource_tenantId_companyId_id_key" ON "ServiceInvoiceSource"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceInvoiceSource_subscriptionId_periodIndex_correctionI_key" ON "ServiceInvoiceSource"("subscriptionId", "periodIndex", "correctionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_serviceSourceId_key" ON "Invoice"("serviceSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_companyId_serviceSourceId_key" ON "Invoice"("tenantId", "companyId", "serviceSourceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_serviceSourceId_fkey" FOREIGN KEY ("tenantId", "companyId", "serviceSourceId") REFERENCES "ServiceInvoiceSource"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPlanRevision" ADD CONSTRAINT "BillingPlanRevision_tenantId_companyId_planId_fkey" FOREIGN KEY ("tenantId", "companyId", "planId") REFERENCES "BillingPlan"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscriptionRevision" ADD CONSTRAINT "BillingSubscriptionRevision_tenantId_companyId_subscriptio_fkey" FOREIGN KEY ("tenantId", "companyId", "subscriptionId") REFERENCES "BillingSubscription"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceInvoiceSource" ADD CONSTRAINT "ServiceInvoiceSource_tenantId_companyId_subscriptionId_fkey" FOREIGN KEY ("tenantId", "companyId", "subscriptionId") REFERENCES "BillingSubscription"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" ADD CONSTRAINT invoice_exactly_one_source CHECK (("orderId" IS NOT NULL)::int + ("serviceSourceId" IS NOT NULL)::int=1);
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['BillingPlan','BillingPlanRevision','BillingSubscription','BillingSubscriptionRevision','BillingRequest','ServiceInvoiceSource'] LOOP
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT',t);
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT',t);
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['BillingPlanRevision','BillingSubscriptionRevision','ServiceInvoiceSource'] LOOP
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","requestId") REFERENCES "BillingRequest"("tenantId","companyId",id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED',t);
 END LOOP;
END $$;
ALTER TABLE "BillingSubscription" ADD FOREIGN KEY ("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "BillingSubscription" ADD FOREIGN KEY ("tenantId","companyId","manualSubscriptionId") REFERENCES "ManualSubscription"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "BillingSubscriptionRevision" ADD FOREIGN KEY ("tenantId","companyId","planRevisionId") REFERENCES "BillingPlanRevision"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ServiceInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ServiceInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","subscriptionRevisionId") REFERENCES "BillingSubscriptionRevision"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ServiceInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","planRevisionId") REFERENCES "BillingPlanRevision"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ServiceInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","replacesSourceId") REFERENCES "ServiceInvoiceSource"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "BillingRequest" ADD CHECK (outcome IN ('COMMITTED','ABANDONED') AND action IN ('plan','configure','generate','backfill','replace') AND jsonb_typeof(request)='object');
ALTER TABLE "ServiceInvoiceSource" ADD CHECK ("periodIndex" BETWEEN 0 AND 100000 AND "correctionIndex">=0 AND ("correctionIndex"=0)=("replacesSourceId" IS NULL) AND "periodStart"<"periodEnd" AND subtotal>=0 AND "taxAmount">=0);
ALTER TABLE "BillingSubscriptionRevision" ADD CHECK (version>0 AND "effectivePeriod" BETWEEN 0 AND 100000 AND status IN ('ACTIVE','PAUSED','ENDED'));
ALTER TABLE "BillingPlanRevision" ADD CHECK(version>0);
INSERT INTO "Permission"(key) VALUES('billing-subscription:read'),('billing-subscription:manage'),('billing-subscription:generate') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('billing-subscription:read'),('billing-subscription:manage'),('billing-subscription:generate')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;

-- The same original-anchor calendar is checked independently of application code.
CREATE FUNCTION erp_billing_boundary(anchor DATE,cadence JSONB,idx INTEGER) RETURNS DATE LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE d DATE; n INTEGER; y INTEGER; m INTEGER; day INTEGER;
BEGIN
 IF anchor IS NULL OR anchor NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' OR idx IS NULL OR idx NOT BETWEEN 0 AND 100000 OR jsonb_typeof(cadence)<>'object' THEN RAISE EXCEPTION 'Invalid billing calendar' USING ERRCODE='23514'; END IF;
 IF cadence->>'kind'='DAYS' THEN
 n:=(cadence->>'days')::integer;IF n IS NULL OR n NOT BETWEEN 1 AND 3660 OR cadence<>jsonb_build_object('kind','DAYS','days',n) THEN RAISE EXCEPTION 'Invalid day cadence' USING ERRCODE='23514'; END IF;d:=anchor+n*idx;
 ELSIF cadence->>'kind'='MONTHLY' THEN
 n:=(cadence->>'months')::integer;IF n IS NULL OR n NOT BETWEEN 1 AND 120 OR cadence->>'rule' IS NULL OR cadence->>'rule' NOT IN ('CLAMP_ORIGINAL_DAY','MONTH_END') OR cadence<>jsonb_build_object('kind','MONTHLY','months',n,'rule',cadence->>'rule') THEN RAISE EXCEPTION 'Invalid month cadence' USING ERRCODE='23514'; END IF;
 d:=(date_trunc('month',anchor)+(n*idx||' months')::interval+interval '1 month - 1 day')::date;
 IF cadence->>'rule'='MONTH_END' THEN
 IF anchor<>(date_trunc('month',anchor)+interval '1 month - 1 day')::date THEN RAISE EXCEPTION 'Month-end anchor required' USING ERRCODE='23514'; END IF;
 ELSE d:=make_date(extract(year FROM d)::integer,extract(month FROM d)::integer,least(extract(day FROM anchor)::integer,extract(day FROM d)::integer));END IF;
 ELSIF cadence->>'kind'='ANNUAL' THEN
 n:=(cadence->>'years')::integer;IF n IS NULL OR n NOT BETWEEN 1 AND 10 OR cadence->>'leapDay' IS NULL OR cadence->>'leapDay' NOT IN ('FEBRUARY_28','MARCH_1') OR cadence<>jsonb_build_object('kind','ANNUAL','years',n,'leapDay',cadence->>'leapDay') THEN RAISE EXCEPTION 'Explicit leap-day rule required' USING ERRCODE='23514'; END IF;
 y:=extract(year FROM anchor)::integer+n*idx;m:=extract(month FROM anchor)::integer;day:=extract(day FROM anchor)::integer;
 IF m=2 AND day=29 AND NOT (y%4=0 AND (y%100<>0 OR y%400=0)) THEN d:=CASE cadence->>'leapDay' WHEN 'FEBRUARY_28' THEN make_date(y,2,28) ELSE make_date(y,3,1) END;ELSE d:=make_date(y,m,day);END IF;
 ELSE RAISE EXCEPTION 'Unknown billing cadence' USING ERRCODE='23514'; END IF;
 IF d NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' THEN RAISE EXCEPTION 'Billing date outside supported horizon' USING ERRCODE='23514'; END IF;RETURN d;
END $$;
CREATE FUNCTION erp_billing_due(start_date DATE,end_date DATE,terms JSONB) RETURNS DATE LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE d DATE;n INTEGER;
BEGIN
 IF terms=jsonb_build_object('kind','NONE') THEN RETURN NULL;END IF;
 n:=(terms->>'days')::integer;
 IF terms->>'kind' IS DISTINCT FROM 'OFFSET' OR n IS NULL OR n NOT BETWEEN 0 AND 3650 OR terms->>'label' IS NULL OR length(btrim(terms->>'label')) NOT BETWEEN 3 AND 120 OR terms->>'base' IS NULL OR terms->>'base' NOT IN ('PERIOD_START','PERIOD_END') OR terms<>jsonb_build_object('kind','OFFSET','label',terms->>'label','days',n,'base',terms->>'base') THEN RAISE EXCEPTION 'Invalid copied payment terms' USING ERRCODE='23514';END IF;
 d:=(CASE terms->>'base' WHEN 'PERIOD_START' THEN start_date ELSE end_date END)+n;
 IF d NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31' THEN RAISE EXCEPTION 'Payment due outside supported date range' USING ERRCODE='23514'; END IF;RETURN d;
END $$;
CREATE FUNCTION erp_billing_prices(lines JSONB,vat_active BOOLEAN) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE l JSONB; pos INTEGER:=0; q BIGINT; unit NUMERIC; net NUMERIC; tax NUMERIC; result JSONB:='[]'; total NUMERIC:=0; taxes NUMERIC:=0;
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Billing lines required' USING ERRCODE='23514'; END IF;
 FOR l IN SELECT value FROM jsonb_array_elements(lines) LOOP
 IF jsonb_typeof(l->'description') IS DISTINCT FROM 'string' OR length(btrim(l->>'description'))<1 OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number' OR (l->>'quantity') !~ '^[1-9][0-9]*$' OR jsonb_typeof(l->'unitPrice') IS DISTINCT FROM 'string' OR (l->>'unitPrice') !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR l->>'treatment' IS NULL OR l->>'treatment' NOT IN ('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Invalid exact billing prices' USING ERRCODE='23514';END IF;
 q:=(l->>'quantity')::bigint;unit:=(l->>'unitPrice')::numeric;
 IF q>2147483647 OR l<>jsonb_build_object('description',l->>'description','quantity',q,'unitPrice',l->>'unitPrice','treatment',l->>'treatment') THEN RAISE EXCEPTION 'Invalid billing line payload' USING ERRCODE='23514';END IF;
 net:=q*unit;tax:=CASE WHEN vat_active AND l->>'treatment'='STANDARD' THEN round(net*0.05,3) ELSE 0 END;total:=total+net;taxes:=taxes+tax;
 IF total+taxes>999999999999999.999 THEN RAISE EXCEPTION 'Billing total overflow' USING ERRCODE='23514'; END IF;
 result:=result||jsonb_build_array(jsonb_build_object('position',pos,'description',l->>'description','quantity',q,'unitPrice',to_char(unit,'FM999999999999999990.000'),'amount',to_char(net,'FM999999999999999990.000'),'treatment',l->>'treatment','tax',to_char(tax,'FM999999999999999990.000')));pos:=pos+1;
 END LOOP;
 RETURN jsonb_build_object('lines',result,'subtotal',to_char(total,'FM999999999999999990.000'),'taxAmount',to_char(taxes,'FM999999999999999990.000'));
END $$;
CREATE FUNCTION erp_billing_guard_head() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Billing writes require READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Billing identities cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
 IF NEW.version<>1 THEN RAISE EXCEPTION 'Billing version starts at one' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."updatedAt":=NEW."createdAt";
 ELSE
 IF (to_jsonb(NEW)-ARRAY['version','archived','label','updatedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','archived','label','updatedAt']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Immutable billing identity or nonsequential version' USING ERRCODE='23514';END IF;
 NEW."updatedAt":=clock_timestamp() AT TIME ZONE 'UTC';
 END IF;
 IF TG_TABLE_NAME='BillingSubscription' THEN
 PERFORM id FROM "Customer" WHERE id=NEW."customerId" FOR SHARE;
 PERFORM erp_billing_boundary(NEW.anchor,NEW.cadence,0);
 IF NOT EXISTS(SELECT 1 FROM "Customer" c WHERE c.id=NEW."customerId" AND c."tenantId"=NEW."tenantId" AND c."companyId"=NEW."companyId" AND (c."branchId" IS NULL OR c."branchId" IS NOT DISTINCT FROM NEW."branchId")) THEN RAISE EXCEPTION 'Billing customer scope mismatch' USING ERRCODE='23514';END IF;
 IF NEW."manualSubscriptionId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ManualSubscription" m WHERE m.id=NEW."manualSubscriptionId" AND m."tenantId"=NEW."tenantId" AND m."companyId"=NEW."companyId" AND m."branchId" IS NOT DISTINCT FROM NEW."branchId" AND m."customerId"=NEW."customerId") THEN RAISE EXCEPTION 'Manual navigation source mismatch' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_plan_head BEFORE INSERT OR UPDATE OR DELETE ON "BillingPlan" FOR EACH ROW EXECUTE FUNCTION erp_billing_guard_head();
CREATE TRIGGER billing_subscription_head BEFORE INSERT OR UPDATE OR DELETE ON "BillingSubscription" FOR EACH ROW EXECUTE FUNCTION erp_billing_guard_head();
CREATE FUNCTION erp_billing_guard_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Billing history is immutable' USING ERRCODE='23514';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Billing writes require READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='ServiceInvoiceSource' THEN PERFORM id FROM "Customer" WHERE id=(to_jsonb(NEW)->>'customerId')::uuid FOR SHARE;END IF;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."creationTransaction":=txid_current()::text;
 RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['BillingPlanRevision','BillingSubscriptionRevision','BillingRequest','ServiceInvoiceSource'] LOOP
 EXECUTE format('CREATE TRIGGER billing_history BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION erp_billing_guard_history()',t);
END LOOP;END $$;
CREATE FUNCTION erp_billing_head_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD;
BEGIN
 IF TG_TABLE_NAME='BillingPlan' THEN
 SELECT * INTO r FROM "BillingPlanRevision" WHERE "planId"=NEW.id AND version=NEW.version;
 IF NOT FOUND OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW.label,NEW.currency,NEW.archived) IS DISTINCT FROM (r."tenantId",r."companyId",r."branchId",r.label,r.currency,r.archived) OR r."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Billing plan head needs exact current-transaction revision' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO r FROM "BillingSubscriptionRevision" WHERE "subscriptionId"=NEW.id AND version=NEW.version;
 IF NOT FOUND OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW.archived) IS DISTINCT FROM (r."tenantId",r."companyId",r."branchId",r.archived) OR r."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Billing subscription head needs exact current-transaction revision' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_OP='INSERT' AND NEW."createdBy" IS DISTINCT FROM r."createdBy" THEN RAISE EXCEPTION 'Billing identity creator must match initial request actor' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_plan_complete AFTER INSERT OR UPDATE ON "BillingPlan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_billing_head_complete();
CREATE CONSTRAINT TRIGGER billing_subscription_complete AFTER INSERT OR UPDATE ON "BillingSubscription" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_billing_head_complete();
CREATE FUNCTION erp_billing_revision_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE req "BillingRequest"%ROWTYPE;p JSONB;expected JSONB;s "BillingSubscription"%ROWTYPE;plan "BillingPlanRevision"%ROWTYPE;head "BillingPlan"%ROWTYPE;prev "BillingSubscriptionRevision"%ROWTYPE;c "Customer"%ROWTYPE;
BEGIN
 SELECT * INTO req FROM "BillingRequest" WHERE id=NEW."requestId";
 IF NOT FOUND OR req.outcome<>'COMMITTED' OR req."creationTransaction"<>txid_current()::text OR (req."tenantId",req."companyId",req."branchId",req."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy") THEN RAISE EXCEPTION 'Billing revision requires matching committed request' USING ERRCODE='23514';END IF;
 p:=req.request;
 IF NEW.version IS DISTINCT FROM (p->>'expectedVersion')::integer+1 OR NEW.reason IS DISTINCT FROM p->>'reason' THEN RAISE EXCEPTION 'Billing revision request mismatch' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='BillingPlanRevision' THEN
 IF req.action<>'plan' OR (NEW."planId",NEW.label,NEW.currency,NEW.lines,NEW.archived) IS DISTINCT FROM ((p->>'planId')::uuid,p->>'label',p->>'currency',p->'lines',(p->>'archived')::boolean) THEN RAISE EXCEPTION 'Plan content does not match exact request' USING ERRCODE='23514';END IF;
 SELECT * INTO head FROM "BillingPlan" WHERE id=NEW."planId";
 IF head.version<>NEW.version OR (head."tenantId",head."companyId",head."branchId",head.currency) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW.currency) THEN RAISE EXCEPTION 'Plan revision scope mismatch' USING ERRCODE='23514';END IF;
 IF length(btrim(NEW.label)) NOT BETWEEN 1 AND 200 OR NEW.currency!~'^[A-Z]{3}$' THEN RAISE EXCEPTION 'Invalid plan content' USING ERRCODE='23514';END IF;
 PERFORM erp_billing_prices(NEW.lines,false);
 ELSE
 IF req.action<>'configure' THEN RAISE EXCEPTION 'Configuration request required' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM "BillingSubscription" WHERE id=NEW."subscriptionId";
 SELECT * INTO plan FROM "BillingPlanRevision" WHERE id=NEW."planRevisionId";
 SELECT * INTO head FROM "BillingPlan" WHERE id=plan."planId";
 SELECT * INTO c FROM "Customer" WHERE id=s."customerId";
 IF s.version<>NEW.version OR (s."tenantId",s."companyId",s."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR plan.currency<>s.currency OR (plan."tenantId",plan."companyId") IS DISTINCT FROM (s."tenantId",s."companyId") OR plan."branchId" IS NOT NULL AND plan."branchId" IS DISTINCT FROM s."branchId" OR head.archived OR plan.archived OR c."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'Configuration requires active scoped plan and customer' USING ERRCODE='23514';END IF;
 IF (s.id,s."customerId",s."manualSubscriptionId",s.anchor,s.cadence,NEW."effectivePeriod",plan."planId",plan.version,NEW.horizon,NEW.status,NEW.terms,NEW.archived) IS DISTINCT FROM ((p->>'subscriptionId')::uuid,(p->>'customerId')::uuid,(p->>'manualSubscriptionId')::uuid,(p->>'anchor')::date,p->'cadence',(p->>'effectivePeriod')::integer,(p->>'planId')::uuid,(p->>'planVersion')::integer,(p->>'horizon')::date,p->>'status',p->'terms',(p->>'archived')::boolean) THEN RAISE EXCEPTION 'Configuration differs from exact request' USING ERRCODE='23514';END IF;
 IF s."manualSubscriptionId" IS NOT NULL AND NOT erp_payment_term_actor_access(NEW."createdBy",s."tenantId",s."companyId",s."branchId",'subscription:read') THEN RAISE EXCEPTION 'Manual navigation source read required' USING ERRCODE='23514';END IF;
 IF NEW.horizon<=s.anchor OR NEW.horizon>DATE '2099-12-31' OR NEW."effectivePeriod"=0 AND NEW.version>1 AND EXISTS(SELECT 1 FROM "ServiceInvoiceSource" WHERE "subscriptionId"=s.id) THEN RAISE EXCEPTION 'Finite ungenerated configuration horizon required' USING ERRCODE='23514';END IF;
 IF NEW.version=1 AND NEW."effectivePeriod"<>0 THEN RAISE EXCEPTION 'Initial configuration starts at period zero' USING ERRCODE='23514';END IF;
 SELECT * INTO prev FROM "BillingSubscriptionRevision" WHERE "subscriptionId"=s.id AND version=NEW.version-1;
 IF NEW.version>1 AND (NOT FOUND OR NEW."effectivePeriod"<prev."effectivePeriod") THEN RAISE EXCEPTION 'Configuration boundary cannot move backward' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM "ServiceInvoiceSource" WHERE "subscriptionId"=s.id AND "periodIndex">=NEW."effectivePeriod") THEN RAISE EXCEPTION 'Generated periods cannot be reconfigured' USING ERRCODE='23514';END IF;
 PERFORM erp_billing_due(erp_billing_boundary(s.anchor,s.cadence,NEW."effectivePeriod"),erp_billing_boundary(s.anchor,s.cadence,NEW."effectivePeriod"+1),NEW.terms);
 IF NOT erp_payment_term_actor_access(NEW."createdBy",plan."tenantId",plan."companyId",plan."branchId",'billing-subscription:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",s."tenantId",c."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Customer authorization required' USING ERRCODE='23514';END IF;
 END IF;
 IF req.result IS DISTINCT FROM (CASE WHEN TG_TABLE_NAME='BillingPlanRevision' THEN jsonb_build_object('kind','plan','planId',(to_jsonb(NEW)->>'planId')::uuid,'revisionId',NEW.id,'version',NEW.version) ELSE jsonb_build_object('kind','configuration','subscriptionId',(to_jsonb(NEW)->>'subscriptionId')::uuid,'revisionId',NEW.id,'version',NEW.version) END) THEN RAISE EXCEPTION 'Exact configuration receipt required' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_plan_revision_complete AFTER INSERT ON "BillingPlanRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_billing_revision_complete();
CREATE CONSTRAINT TRIGGER billing_subscription_revision_complete AFTER INSERT ON "BillingSubscriptionRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_billing_revision_complete();
CREATE FUNCTION erp_billing_request_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p JSONB; expected JSONB; permission TEXT;c "Customer"%ROWTYPE;s "BillingSubscription"%ROWTYPE;i "Invoice"%ROWTYPE;src "ServiceInvoiceSource"%ROWTYPE;
BEGIN
 -- All potentially waiting locks precede fresh actor authorization.
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Billing writes require READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 p:=NEW.request;
 IF NEW.id=COALESCE((p->>'planId')::uuid,(p->>'subscriptionId')::uuid) OR COALESCE(p->>'planId',p->>'subscriptionId') IS NULL THEN RAISE EXCEPTION 'Separate valid billing object and request identities required' USING ERRCODE='23514';END IF;
 IF NEW.action<>'plan' THEN
 SELECT * INTO s FROM "BillingSubscription" WHERE id=(p->>'subscriptionId')::uuid;
 IF s.id IS NOT NULL THEN SELECT * INTO c FROM "Customer" WHERE id=s."customerId" FOR SHARE;ELSE SELECT * INTO c FROM "Customer" WHERE id=(p->>'customerId')::uuid FOR SHARE;END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-object:'||COALESCE(p->>'subscriptionId',p->>'planId'),0));
 IF NEW.action IN ('generate','backfill','replace') THEN PERFORM pg_advisory_xact_lock(hashtextextended('billing-period:'||(p->>'subscriptionId')||':'||(p->>'periodIndex'),0));END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('billing-request:'||NEW.id::text,0));
 permission:=CASE WHEN NEW.action IN ('plan','configure') THEN 'billing-subscription:manage' ELSE 'billing-subscription:generate' END;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'billing-subscription:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current billing authorization required' USING ERRCODE='23514';END IF;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'expectedActorId',NEW."createdBy",'requestId',NEW.id,'action',NEW.action,'reason',p->'reason');
 IF NEW.action='plan' THEN expected:=expected||jsonb_build_object('planId',p->'planId','expectedVersion',p->'expectedVersion','label',p->'label','currency',p->'currency','lines',p->'lines','archived',p->'archived');
 ELSIF NEW.action='configure' THEN expected:=expected||jsonb_build_object('subscriptionId',p->'subscriptionId','customerId',p->'customerId','manualSubscriptionId',p->'manualSubscriptionId','expectedVersion',p->'expectedVersion','anchor',p->'anchor','cadence',p->'cadence','effectivePeriod',p->'effectivePeriod','planId',p->'planId','planVersion',p->'planVersion','horizon',p->'horizon','status',p->'status','terms',p->'terms','archived',p->'archived');
 ELSE expected:=expected||jsonb_build_object('subscriptionId',p->'subscriptionId','expectedVersion',p->'expectedVersion','periodIndex',p->'periodIndex','previewHash',p->'previewHash','replacesSourceId',p->'replacesSourceId','replacementPlanRevisionId',p->'replacementPlanRevisionId');END IF;
 IF p IS DISTINCT FROM expected OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(btrim(p->>'reason')) NOT BETWEEN 1 AND 300 OR (p->>'reason')~'[[:cntrl:]]' OR jsonb_typeof(p->'expectedVersion') IS DISTINCT FROM 'number' OR (p->>'expectedVersion')!~'^[0-9]+$' THEN RAISE EXCEPTION 'Canonical actor-bound billing request required' USING ERRCODE='23514';END IF;
 IF NEW.action<>'plan' AND (c.id IS NULL OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",c."companyId",c."branchId",'customer:read') OR (c."tenantId",c."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId") THEN RAISE EXCEPTION 'Current billing customer scope required' USING ERRCODE='23514';END IF;
 IF NEW.outcome='ABANDONED' THEN
 IF NEW.result<>jsonb_build_object('kind','abandoned') OR EXISTS(SELECT 1 FROM "BillingPlanRevision" WHERE "requestId"=NEW.id) OR EXISTS(SELECT 1 FROM "BillingSubscriptionRevision" WHERE "requestId"=NEW.id) OR EXISTS(SELECT 1 FROM "ServiceInvoiceSource" WHERE "requestId"=NEW.id) THEN RAISE EXCEPTION 'Abandoned request cannot create billing history' USING ERRCODE='23514';END IF;RETURN NULL;END IF;
 IF NEW.action='plan' THEN
 IF NOT EXISTS(SELECT 1 FROM "BillingPlanRevision" WHERE "requestId"=NEW.id) THEN RAISE EXCEPTION 'Committed plan needs revision' USING ERRCODE='23514';END IF;
 ELSIF NEW.action='configure' THEN
 IF NOT EXISTS(SELECT 1 FROM "BillingSubscriptionRevision" WHERE "requestId"=NEW.id) THEN RAISE EXCEPTION 'Committed configuration needs revision' USING ERRCODE='23514';END IF;
 ELSE
 IF s.id IS NULL OR (s."tenantId",s."companyId",s."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'invoice:create') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'invoice:read') OR p->>'previewHash' IS NULL OR p->>'previewHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invoice creation authorization and preview required' USING ERRCODE='23514';END IF;
 SELECT * INTO src FROM "ServiceInvoiceSource" WHERE "requestId"=NEW.id;
 IF FOUND THEN
 SELECT * INTO i FROM "Invoice" WHERE "serviceSourceId"=src.id;
 expected:=jsonb_build_object('kind','invoice','subscriptionId',s.id,'periodIndex',src."periodIndex",'serviceSourceId',src.id,'invoice',jsonb_build_object('id',i.id,'number',i.number,'status','DRAFT'),'alreadyGenerated',false);
 ELSE
 IF NEW.action='replace' OR NEW.result->'alreadyGenerated' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'New invoice request needs immutable source' USING ERRCODE='23514';END IF;
 SELECT source.* INTO src FROM "ServiceInvoiceSource" source JOIN "Invoice" inv ON inv."serviceSourceId"=source.id WHERE source."subscriptionId"=s.id AND source."correctionIndex"=0 AND source."periodIndex"=(p->>'periodIndex')::integer AND inv.id=(NEW.result->'invoice'->>'id')::uuid;
 SELECT * INTO i FROM "Invoice" WHERE "serviceSourceId"=src.id;
 IF src.id IS NULL OR i.id IS NULL THEN RAISE EXCEPTION 'Replay invoice must belong to original period' USING ERRCODE='23514';END IF;
 expected:=jsonb_build_object('kind','invoice','subscriptionId',s.id,'periodIndex',src."periodIndex",'serviceSourceId',src.id,'invoice',jsonb_build_object('id',i.id,'number',i.number,'status',i.status),'alreadyGenerated',true);
 END IF;
 IF NEW.result IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Exact billing invoice receipt required' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_request_complete AFTER INSERT ON "BillingRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_billing_request_complete();
CREATE FUNCTION erp_billing_invoice_journal(invoice_id UUID) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
DECLARE n NUMERIC:=0;bytes BYTEA:=uuid_send(invoice_id);digits TEXT:='';idx INTEGER;
BEGIN
 FOR idx IN 0..15 LOOP n:=n*256+get_byte(bytes,idx);END LOOP;
 WHILE n>0 LOOP digits:=substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',mod(n,36)::integer+1,1)||digits;n:=div(n,36);END LOOP;
 RETURN 'SYSI-'||lpad(digits,25,'0');
END $$;
CREATE FUNCTION erp_service_source_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s "BillingSubscription"%ROWTYPE;r "BillingSubscriptionRevision"%ROWTYPE;p "BillingPlanRevision"%ROWTYPE;h "BillingPlan"%ROWTYPE;c "Customer"%ROWTYPE;v "CompanyVatProfile"%ROWTYPE;req "BillingRequest"%ROWTYPE;i "Invoice"%ROWTYPE;old_source "ServiceInvoiceSource"%ROWTYPE;prices JSONB;taxable BOOLEAN;due DATE;prior_invoice UUID;
BEGIN
 SELECT * INTO s FROM "BillingSubscription" WHERE id=NEW."subscriptionId";
 SELECT * INTO r FROM "BillingSubscriptionRevision" WHERE "subscriptionId"=s.id AND "effectivePeriod"<=NEW."periodIndex" ORDER BY version DESC LIMIT 1;
 SELECT * INTO p FROM "BillingPlanRevision" WHERE id=NEW."planRevisionId";
 SELECT * INTO h FROM "BillingPlan" WHERE id=p."planId";
 SELECT * INTO c FROM "Customer" WHERE id=s."customerId";
 SELECT * INTO req FROM "BillingRequest" WHERE id=NEW."requestId";
 SELECT * INTO v FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 SELECT * INTO i FROM "Invoice" WHERE "serviceSourceId"=NEW.id;
 taxable:=COALESCE(v.enabled AND v."effectiveFrom"<=NEW."createdAt"::date,false);
 IF s.id IS NULL OR r.id IS NULL OR p.id IS NULL OR c.id IS NULL OR req.id IS NULL OR i.id IS NULL OR req.outcome<>'COMMITTED' OR req."creationTransaction"<>NEW."creationTransaction" OR NEW."creationTransaction"<>txid_current()::text OR i."creationTransaction"<>NEW."creationTransaction" OR req.action NOT IN ('generate','backfill','replace') THEN RAISE EXCEPTION 'Service source requires same-transaction request, configuration and invoice' USING ERRCODE='23514';END IF;
 IF (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."customerName",NEW.currency,NEW."subscriptionRevisionId") IS DISTINCT FROM (s."tenantId",s."companyId",s."branchId",s."customerId",c."displayName",s.currency,r.id) OR (p."tenantId",p."companyId",p.currency) IS DISTINCT FROM (s."tenantId",s."companyId",s.currency) OR p."branchId" IS NOT NULL AND p."branchId" IS DISTINCT FROM s."branchId" OR (req."tenantId",req."companyId",req."branchId",req."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy") THEN RAISE EXCEPTION 'Service source scope mismatch' USING ERRCODE='23514';END IF;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",p."tenantId",p."companyId",p."branchId",'billing-subscription:read') THEN RAISE EXCEPTION 'Plan scope read required' USING ERRCODE='23514';END IF;
 IF NEW."subscriptionId" IS DISTINCT FROM (req.request->>'subscriptionId')::uuid OR NEW."periodIndex" IS DISTINCT FROM (req.request->>'periodIndex')::integer OR NEW."replacesSourceId" IS DISTINCT FROM (req.request->>'replacesSourceId')::uuid OR NEW.reason IS DISTINCT FROM req.request->>'reason' OR s.version IS DISTINCT FROM (req.request->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Service source does not match current request revision' USING ERRCODE='23514';END IF;
 IF s.archived OR r.archived OR p.archived OR h.archived OR c."archivedAt" IS NOT NULL OR (r.status<>'ACTIVE' AND NOT ((req.action='backfill' AND NEW."periodEnd"<=NEW."createdAt"::date) OR req.action='replace')) THEN RAISE EXCEPTION 'Billing action requires eligible nonarchived configuration' USING ERRCODE='23514';END IF;
 IF NEW."periodStart"<>erp_billing_boundary(s.anchor,s.cadence,NEW."periodIndex") OR NEW."periodEnd"<>erp_billing_boundary(s.anchor,s.cadence,NEW."periodIndex"+1) OR NEW."periodEnd">r.horizon OR NEW."periodStart">NEW."createdAt"::date THEN RAISE EXCEPTION 'Whole current or explicit backfill period within finite horizon required' USING ERRCODE='23514';END IF;
 IF req.action='backfill' AND NEW."periodEnd">NEW."createdAt"::date THEN RAISE EXCEPTION 'Backfill requires an ended historical period' USING ERRCODE='23514';END IF;
 IF req.action='generate' AND NEW."periodEnd"<=NEW."createdAt"::date THEN RAISE EXCEPTION 'Skipped historical periods require explicit backfill' USING ERRCODE='23514';END IF;
 IF NEW."correctionIndex"=0 THEN
 IF NEW."planRevisionId"<>r."planRevisionId" OR req.action='replace' OR req.request->'replacementPlanRevisionId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Ordinary period uses exact configured plan' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO old_source FROM "ServiceInvoiceSource" WHERE id=NEW."replacesSourceId";
 IF req.action<>'replace' OR NEW."planRevisionId" IS DISTINCT FROM (req.request->>'replacementPlanRevisionId')::uuid OR (old_source."subscriptionId",old_source."periodIndex",old_source."periodStart",old_source."periodEnd",old_source.currency) IS DISTINCT FROM (NEW."subscriptionId",NEW."periodIndex",NEW."periodStart",NEW."periodEnd",NEW.currency) OR NEW."correctionIndex"<>old_source."correctionIndex"+1 OR NOT EXISTS(SELECT 1 FROM "Invoice" WHERE "serviceSourceId"=old_source.id AND status='VOID') THEN RAISE EXCEPTION 'Explicit linked replacement requires prior VOID invoice' USING ERRCODE='23514';END IF;
 SELECT id INTO prior_invoice FROM "Invoice" WHERE "serviceSourceId"=old_source.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "JournalEntry" j WHERE j."tenantId"=NEW."tenantId" AND j."companyId"=NEW."companyId" AND (j.number=erp_billing_invoice_journal(prior_invoice) OR EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a.entity='Invoice' AND a."entityId"=prior_invoice::text AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=j.id::text)) AND NOT EXISTS(SELECT 1 FROM "JournalEntry" rev WHERE rev."reversalOf"=j.id)) OR EXISTS(SELECT 1 FROM "CustomerSettlement" cs JOIN "JournalEntry" j ON j.id=cs."entryId" WHERE cs."tenantId"=NEW."tenantId" AND cs."invoiceId"=prior_invoice AND NOT EXISTS(SELECT 1 FROM "JournalEntry" rev WHERE rev."reversalOf"=j.id)) THEN RAISE EXCEPTION 'Replacement requires reversal of original posting and every active settlement' USING ERRCODE='23514';END IF;

 END IF;
 prices:=erp_billing_prices(p.lines,taxable);due:=erp_billing_due(NEW."periodStart",NEW."periodEnd",r.terms);
 IF NEW.lines IS DISTINCT FROM prices->'lines' OR NEW.subtotal IS DISTINCT FROM (prices->>'subtotal')::numeric OR NEW."taxAmount" IS DISTINCT FROM (prices->>'taxAmount')::numeric OR NEW."vatProfileRevision" IS DISTINCT FROM (CASE WHEN taxable THEN v.revision ELSE NULL END) OR NEW."paymentDueDate" IS DISTINCT FROM due OR NEW."paymentTerms" IS DISTINCT FROM (CASE WHEN due IS NULL THEN NULL ELSE r.terms->>'label' END) OR taxable AND NEW.currency<>'OMR' THEN RAISE EXCEPTION 'Exact configured price, tax and payment-term snapshots required' USING ERRCODE='23514';END IF;
 IF i.status<>'DRAFT' OR (i."tenantId",i."companyId",i."branchId",i."customerId",i."customerName",i.currency,i.subtotal,i."paymentTerms",i."paymentDueDate",i."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."customerName",NEW.currency,NEW.subtotal,NEW."paymentTerms",NEW."paymentDueDate",NEW."createdBy") THEN RAISE EXCEPTION 'Service invoice must match its immutable source' USING ERRCODE='23514';END IF;
 IF (SELECT COALESCE(jsonb_agg(jsonb_build_object('position',l.position,'description',l.description,'quantity',l.quantity,'unitPrice',to_char(l."unitPrice",'FM999999999999999990.000'),'amount',to_char(l.amount,'FM999999999999999990.000')) ORDER BY l.position),'[]'::jsonb) FROM "InvoiceLine" l WHERE l."invoiceId"=i.id) IS DISTINCT FROM (SELECT jsonb_agg(e.value-ARRAY['treatment','tax'] ORDER BY (e.value->>'position')::integer) FROM jsonb_array_elements(NEW.lines) e) THEN RAISE EXCEPTION 'Invoice line parity required' USING ERRCODE='23514';END IF;
 IF taxable THEN
 IF NOT EXISTS(SELECT 1 FROM "InvoiceVat" iv WHERE iv."invoiceId"=i.id AND iv."taxAmount"=NEW."taxAmount" AND iv.details=(SELECT jsonb_agg(jsonb_build_object('position',(e.value->>'position')::integer,'treatment',e.value->>'treatment','net',e.value->>'amount','tax',e.value->>'tax') ORDER BY (e.value->>'position')::integer) FROM jsonb_array_elements(NEW.lines) e)) THEN RAISE EXCEPTION 'Service VAT classifications must match plan snapshot' USING ERRCODE='23514';END IF;
 ELSIF EXISTS(SELECT 1 FROM "InvoiceVat" WHERE "invoiceId"=i.id) THEN RAISE EXCEPTION 'Inactive VAT regime must not create VAT record' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER service_source_complete AFTER INSERT ON "ServiceInvoiceSource" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_service_source_complete();
CREATE FUNCTION erp_invoice_source_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s "ServiceInvoiceSource"%ROWTYPE;
BEGIN
 IF NEW."orderId" IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM "SalesOrder" o WHERE o.id=NEW."orderId" AND o."tenantId"=NEW."tenantId" AND o."companyId"=NEW."companyId" AND o.status='COMPLETED') THEN RAISE EXCEPTION 'New order invoice requires completed real sales order' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO s FROM "ServiceInvoiceSource" WHERE id=NEW."serviceSourceId";
 IF s.id IS NULL OR s."creationTransaction"<>txid_current()::text OR NEW.status<>'DRAFT' OR NEW."creationTransaction"<>txid_current()::text OR (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId") IS DISTINCT FROM (s."tenantId",s."companyId",s."branchId",s."customerId") THEN RAISE EXCEPTION 'New service invoice requires same-transaction configured source' USING ERRCODE='23514';END IF;
 NEW."createdAt":=s."createdAt";
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER invoice_source_insert BEFORE INSERT ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_invoice_source_insert();
CREATE TRIGGER billing_invoice_no_truncate BEFORE TRUNCATE ON "Invoice" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE TRIGGER billing_invoice_line_no_truncate BEFORE TRUNCATE ON "InvoiceLine" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE TRIGGER billing_invoice_vat_no_truncate BEFORE TRUNCATE ON "InvoiceVat" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE FUNCTION erp_billing_customer_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "BillingSubscription" WHERE "customerId"=OLD.id) THEN RAISE EXCEPTION 'Billing customer source scope is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER billing_customer_scope BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION erp_billing_customer_scope();
CREATE FUNCTION erp_billing_request_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'billing.'||lower(NEW.outcome),'BillingRequest',NEW.id::text,jsonb_build_object('action',NEW.action,'outcome',NEW.outcome),NEW."createdAt");RETURN NEW;
END $$;
CREATE TRIGGER billing_request_audit AFTER INSERT ON "BillingRequest" FOR EACH ROW EXECUTE FUNCTION erp_billing_request_audit();
CREATE FUNCTION erp_billing_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity='BillingRequest' THEN RAISE EXCEPTION 'Billing audit immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF NEW.entity='BillingRequest' AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Billing audit is request-generated' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER billing_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_billing_audit_guard();
DO $$ DECLARE t TEXT;r TEXT;f TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['BillingPlan','BillingPlanRevision','BillingSubscription','BillingSubscriptionRevision','BillingRequest','ServiceInvoiceSource'] LOOP
 EXECUTE format('CREATE TRIGGER billing_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate()',t);
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('erp_billing_boundary','erp_billing_due','erp_billing_prices','erp_billing_guard_head','erp_billing_guard_history','erp_billing_head_complete','erp_billing_revision_complete','erp_billing_request_complete','erp_billing_invoice_journal','erp_service_source_complete','erp_invoice_source_insert','erp_billing_customer_scope','erp_billing_request_audit','erp_billing_audit_guard') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
