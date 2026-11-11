BEGIN;
-- Operator-recorded requests and offers. This migration sends nothing and backfills nothing.
CREATE TABLE "SupplierRfq" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 title TEXT NOT NULL,deadline DATE,notes TEXT NOT NULL,lines JSONB NOT NULL,currency VARCHAR(3) NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),"requestRevision" INTEGER NOT NULL CHECK("requestRevision">0),
 status VARCHAR(9) NOT NULL CHECK(status IN ('DRAFT','OPEN','AWARDED','CANCELLED')),"purchaseOrderId" UUID UNIQUE,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 CHECK((status='AWARDED')=("purchaseOrderId" IS NOT NULL)),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SupplierRfq_tenantId_companyId_branchId_updatedAt_id_idx" ON "SupplierRfq"("tenantId","companyId","branchId","updatedAt",id);
CREATE TABLE "SupplierOffer" (
 id UUID PRIMARY KEY,"rfqId" UUID NOT NULL,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 "supplierId" UUID NOT NULL REFERENCES "Supplier"(id) ON DELETE RESTRICT,"supplierBranchId" UUID,"supplierName" TEXT NOT NULL,"supplierCode" TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),"requestRevision" INTEGER NOT NULL CHECK("requestRevision">0),currency VARCHAR(3) NOT NULL,"validUntil" DATE,notes TEXT NOT NULL,lines JSONB NOT NULL,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId","rfqId") REFERENCES "SupplierRfq"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SupplierOffer_tenantId_companyId_rfqId_updatedAt_id_idx" ON "SupplierOffer"("tenantId","companyId","rfqId","updatedAt",id);
CREATE INDEX "SupplierOffer_supplierId_idx" ON "SupplierOffer"("supplierId");
CREATE TABLE "SupplierRfqRequest" (
 id UUID PRIMARY KEY,"rfqId" UUID NOT NULL,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 "createdBy" UUID NOT NULL,action VARCHAR(6) NOT NULL CHECK(action IN ('create','edit','open','cancel','offer','award')),
 "expectedVersion" INTEGER NOT NULL CHECK("expectedVersion" BETWEEN 0 AND 2147483646),request JSONB NOT NULL,
 outcome VARCHAR(9) NOT NULL CHECK(outcome IN ('COMMITTED','ABANDONED')),result JSONB,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("tenantId","companyId",id),
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SupplierRfqRequest_tenantId_companyId_rfqId_createdAt_idx" ON "SupplierRfqRequest"("tenantId","companyId","rfqId","createdAt");
CREATE TABLE "SupplierRfqRevision" (
 id UUID PRIMARY KEY,"requestId" UUID NOT NULL UNIQUE,"rfqId" UUID NOT NULL,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,
 version INTEGER NOT NULL CHECK(version>0),action VARCHAR(6) NOT NULL CHECK(action IN ('create','edit','open','cancel','offer','award')),
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 request JSONB NOT NULL,rfq JSONB NOT NULL,offer JSONB,"purchaseOrder" JSONB,
 UNIQUE("rfqId",version),
 FOREIGN KEY("tenantId","companyId","rfqId") REFERENCES "SupplierRfq"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","requestId") REFERENCES "SupplierRfqRequest"("tenantId","companyId",id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SupplierRfqRevision_tenantId_companyId_rfqId_version_idx" ON "SupplierRfqRevision"("tenantId","companyId","rfqId",version);
INSERT INTO "Permission"(key) VALUES('rfq:read'),('rfq:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('rfq:read'),('rfq:manage')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
CREATE FUNCTION erp_rfq_date(v JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
BEGIN
 IF v='null'::jsonb THEN RETURN true; END IF;
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(v#>>'{}',4)='0000' THEN RETURN false; END IF;
 RETURN to_char((v#>>'{}')::date,'YYYY-MM-DD')=(v#>>'{}');
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION erp_guard_rfq_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR pg_trigger_depth()<2 OR (TG_TABLE_NAME='SupplierRfqRevision' AND TG_OP<>'INSERT') THEN RAISE EXCEPTION 'RFQ projections and history are request-generated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_rfq_projection BEFORE INSERT OR UPDATE OR DELETE ON "SupplierRfq" FOR EACH ROW EXECUTE FUNCTION erp_guard_rfq_projection();
CREATE TRIGGER guard_offer_projection BEFORE INSERT OR UPDATE OR DELETE ON "SupplierOffer" FOR EACH ROW EXECUTE FUNCTION erp_guard_rfq_projection();
CREATE TRIGGER guard_rfq_revision BEFORE INSERT OR UPDATE OR DELETE ON "SupplierRfqRevision" FOR EACH ROW EXECUTE FUNCTION erp_guard_rfq_projection();
CREATE FUNCTION erp_apply_rfq_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d "SupplierRfq"%ROWTYPE; o "SupplierOffer"%ROWTYPE; s "Supplier"%ROWTYPE; e "SupplierRfqRevision"%ROWTYPE; po "PurchaseOrder"%ROWTYPE;
 p JSONB; expected JSONB; l JSONB; k TEXT; n INTEGER; previous_position INTEGER; has_rfq BOOLEAN; has_offer BOOLEAN:=false; curr TEXT; total NUMERIC:=0; po_json JSONB; offer_json JSONB; rfq_json JSONB; stamp TEXT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'RFQ requests are immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'RFQ writes require READ COMMITTED' USING ERRCODE='23514'; END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-rfq-request:'||NEW.id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier-rfq:'||NEW."rfqId"::text,0));
 SELECT * INTO d FROM "SupplierRfq" WHERE id=NEW."rfqId" FOR UPDATE; has_rfq:=FOUND;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'rfq:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'rfq:manage') THEN RAISE EXCEPTION 'Current RFQ read and management access required' USING ERRCODE='23514'; END IF;
 p:=NEW.request;
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'expectedActorId',NEW."createdBy",'requestId',NEW.id,'rfqId',NEW."rfqId",'expectedVersion',NEW."expectedVersion",'reason',p->'reason','action',NEW.action);
 IF NEW.action IN ('create','edit') THEN expected:=expected||jsonb_build_object('title',p->'title','deadline',p->'deadline','notes',p->'notes','lines',p->'lines'); END IF;
 IF NEW.action='offer' THEN expected:=expected||jsonb_build_object('offerId',p->'offerId','expectedOfferVersion',p->'expectedOfferVersion','supplierId',p->'supplierId','requestRevision',p->'requestRevision','currency',p->'currency','validUntil',p->'validUntil','notes',p->'notes','lines',p->'lines'); END IF;
 IF NEW.action='award' THEN expected:=expected||jsonb_build_object('offerId',p->'offerId','expectedOfferVersion',p->'expectedOfferVersion','requestRevision',p->'requestRevision','purchaseOrderId',p->'purchaseOrderId','purchaseOrderNumber',p->'purchaseOrderNumber','evaluationDate',p->'evaluationDate'); END IF;
 IF p IS DISTINCT FROM expected OR NEW.id=NEW."rfqId" OR jsonb_typeof(p->'reason') IS DISTINCT FROM 'string' OR length(p->>'reason')>300 OR length(btrim(p->>'reason'))<1 OR p->>'reason' ~ '[[:cntrl:]]' OR p->>'reason' ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$' OR ((NEW.action='create') IS DISTINCT FROM (NEW."expectedVersion"=0)) THEN RAISE EXCEPTION 'Exact canonical RFQ command required' USING ERRCODE='23514'; END IF;
 IF has_rfq AND (d."tenantId",d."companyId",d."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") THEN RAISE EXCEPTION 'RFQ scope mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('create','edit','offer') THEN
  IF jsonb_typeof(p->'notes') IS DISTINCT FROM 'string' OR length(p->>'notes')>2000 OR jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines')>50 THEN RAISE EXCEPTION 'Bounded RFQ fields required' USING ERRCODE='23514'; END IF;
  IF NEW.action IN ('create','edit') THEN
   IF jsonb_typeof(p->'title') IS DISTINCT FROM 'string' OR length(p->>'title')>200 OR length(btrim(p->>'title',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))<1 OR p->>'title' ~ '[[:cntrl:]]' OR NOT erp_rfq_date(p->'deadline') OR jsonb_array_length(p->'lines')<1 THEN RAISE EXCEPTION 'Valid RFQ specification required' USING ERRCODE='23514'; END IF;
  ELSE
   IF jsonb_typeof(p->'currency') IS DISTINCT FROM 'string' OR p->>'currency' !~ '^[A-Z]{3}$' OR NOT erp_rfq_date(p->'validUntil') THEN RAISE EXCEPTION 'Valid offer currency and date required' USING ERRCODE='23514'; END IF;
  END IF;
  n:=0; previous_position:=-1;
  FOR l IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
   IF jsonb_typeof(l->'position') IS DISTINCT FROM 'number' OR l->>'position' !~ '^(0|[1-9][0-9]?)$' OR (l->>'position')::int>49 THEN RAISE EXCEPTION 'Valid line position required' USING ERRCODE='23514'; END IF;
   IF NEW.action='offer' THEN
    IF (l->>'position')::int<=previous_position THEN RAISE EXCEPTION 'Offer positions must be strictly ascending' USING ERRCODE='23514'; END IF;
    previous_position:=(l->>'position')::int;
    IF l IS DISTINCT FROM jsonb_build_object('position',l->'position','unitPrice',l->'unitPrice') OR jsonb_typeof(l->'unitPrice') IS DISTINCT FROM 'string' OR l->>'unitPrice' !~ '^(0|[1-9][0-9]{0,8})\.[0-9]{3}$' THEN RAISE EXCEPTION 'Canonical exact offer prices required' USING ERRCODE='23514'; END IF;
   ELSE
    IF l IS DISTINCT FROM jsonb_build_object('position',n,'description',l->'description','quantity',l->'quantity') OR jsonb_typeof(l->'description') IS DISTINCT FROM 'string' OR length(l->>'description') NOT BETWEEN 2 AND 300 OR l->>'description'<>btrim(l->>'description',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') OR l->>'description' ~ '[[:cntrl:]]' OR jsonb_typeof(l->'quantity') IS DISTINCT FROM 'number' OR l->>'quantity' !~ '^[1-9][0-9]{0,5}$' OR (l->>'quantity')::int>100000 THEN RAISE EXCEPTION 'Valid sequential request lines required' USING ERRCODE='23514'; END IF;
   END IF;
   n:=n+1;
  END LOOP;
  IF NEW.action='offer' AND (SELECT count(DISTINCT value->>'position') FROM jsonb_array_elements(p->'lines'))<>n THEN RAISE EXCEPTION 'Duplicate offer positions' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action IN ('offer','award') THEN
  FOREACH k IN ARRAY ARRAY['offerId'] LOOP
   IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR p->>k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Canonical offer identity required' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF (p->>'offerId')::uuid IN (NEW.id,NEW."rfqId") OR jsonb_typeof(p->'expectedOfferVersion') IS DISTINCT FROM 'number' OR p->>'expectedOfferVersion' !~ '^(0|[1-9][0-9]{0,9})$' OR (p->>'expectedOfferVersion')::numeric>2147483646 OR jsonb_typeof(p->'requestRevision') IS DISTINCT FROM 'number' OR p->>'requestRevision' !~ '^[1-9][0-9]{0,9}$' OR (p->>'requestRevision')::numeric>2147483646 THEN RAISE EXCEPTION 'Valid offer revision required' USING ERRCODE='23514'; END IF;
  SELECT * INTO o FROM "SupplierOffer" WHERE id=(p->>'offerId')::uuid FOR UPDATE; has_offer:=FOUND;
  IF NEW.outcome<>'ABANDONED' AND has_offer AND (o."tenantId",o."companyId",o."branchId",o."rfqId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."rfqId") THEN RAISE EXCEPTION 'Offer scope mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.action='offer' THEN
   IF jsonb_typeof(p->'supplierId') IS DISTINCT FROM 'string' OR p->>'supplierId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (NEW.outcome<>'ABANDONED' AND has_offer AND o."supplierId"<>(p->>'supplierId')::uuid) THEN RAISE EXCEPTION 'Supplier identity mismatch' USING ERRCODE='23514'; END IF;
   SELECT * INTO s FROM "Supplier" WHERE id=(p->>'supplierId')::uuid FOR SHARE;
  ELSE
   IF jsonb_typeof(p->'purchaseOrderId') IS DISTINCT FROM 'string' OR p->>'purchaseOrderId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (p->>'purchaseOrderId')::uuid IN (NEW.id,NEW."rfqId",(p->>'offerId')::uuid) OR jsonb_typeof(p->'purchaseOrderNumber') IS DISTINCT FROM 'string' OR p->>'purchaseOrderNumber' !~ '^[A-Z0-9-]{2,30}$' OR p->'evaluationDate'='null'::jsonb OR NOT erp_rfq_date(p->'evaluationDate') OR (p->>'expectedOfferVersion')::int<1 THEN RAISE EXCEPTION 'Explicit purchase order identity and evaluation date required' USING ERRCODE='23514'; END IF;
   IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'purchase-order:read') OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'purchase-order:create') THEN RAISE EXCEPTION 'Current purchase order access required' USING ERRCODE='23514'; END IF;
   SELECT * INTO s FROM "Supplier" WHERE id=o."supplierId" FOR SHARE;
  END IF;
  IF NEW.outcome<>'ABANDONED' AND s.id IS NOT NULL AND ((s."tenantId",s."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",s."branchId",'supplier:read')) THEN RAISE EXCEPTION 'Current supplier source access required' USING ERRCODE='23514'; END IF;
 END IF;
 NEW."createdAt":=clock_timestamp(); NEW.result:=NULL;
 IF NEW.outcome='ABANDONED' THEN RETURN NEW; END IF;
 IF (NEW.action='create' AND has_rfq) OR (NEW.action<>'create' AND (NOT has_rfq OR d.version<>NEW."expectedVersion")) THEN RAISE EXCEPTION 'Stale RFQ version' USING ERRCODE='23514'; END IF;
 SELECT "baseCurrency" INTO curr FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR SHARE;
 IF curr IS NULL THEN RAISE EXCEPTION 'Company not found' USING ERRCODE='23514'; END IF;
 -- Match receipt currency invariants only when capturing a new specification.
 -- Existing history, exact recovery and cancellation remain available after source changes.
 IF NEW.action IN ('create','edit') AND curr !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Valid uppercase company base currency required for RFQ specification' USING ERRCODE='23514'; END IF;
 IF NEW.action<>'create' AND d.status IN ('AWARDED','CANCELLED') THEN RAISE EXCEPTION 'RFQ is terminal' USING ERRCODE='23514'; END IF;
 IF NEW.action='open' AND d.status<>'DRAFT' THEN RAISE EXCEPTION 'Only draft RFQs can open' USING ERRCODE='23514'; END IF;
 IF NEW.action IN ('offer','award') THEN
  IF d.status<>'OPEN' OR (p->>'requestRevision')::int<>d."requestRevision" OR s.id IS NULL OR s."archivedAt" IS NOT NULL OR (s."branchId" IS NOT NULL AND s."branchId" IS DISTINCT FROM d."branchId") THEN RAISE EXCEPTION 'Open current request and eligible supplier required' USING ERRCODE='23514'; END IF;
  IF (has_offer AND o.version<>(p->>'expectedOfferVersion')::int) OR (NOT has_offer AND (p->>'expectedOfferVersion')::int<>0) THEN RAISE EXCEPTION 'Stale offer version' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.action='create' THEN
  INSERT INTO "SupplierRfq"(id,"tenantId","companyId","branchId",title,deadline,notes,lines,currency,version,"requestRevision",status,"createdBy","createdAt","updatedAt") VALUES(NEW."rfqId",NEW."tenantId",NEW."companyId",NEW."branchId",p->>'title',(p->>'deadline')::date,p->>'notes',p->'lines',curr,1,1,'DRAFT',NEW."createdBy",NEW."createdAt",NEW."createdAt") RETURNING * INTO d;
 ELSIF NEW.action='edit' THEN
  UPDATE "SupplierRfq" SET title=p->>'title',deadline=(p->>'deadline')::date,notes=p->>'notes',lines=p->'lines',currency=curr,version=version+1,"requestRevision"="requestRevision"+1,status='DRAFT',"updatedAt"=NEW."createdAt" WHERE id=d.id RETURNING * INTO d;
 ELSIF NEW.action IN ('open','cancel') THEN
  UPDATE "SupplierRfq" SET status=CASE WHEN NEW.action='open' THEN 'OPEN' ELSE 'CANCELLED' END,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=d.id RETURNING * INTO d;
 ELSIF NEW.action='offer' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'lines') x WHERE (x->>'position')::int>=jsonb_array_length(d.lines)) THEN RAISE EXCEPTION 'Offer line outside current request' USING ERRCODE='23514'; END IF;
  IF has_offer THEN
   UPDATE "SupplierOffer" SET version=version+1,"requestRevision"=d."requestRevision",currency=p->>'currency',"validUntil"=(p->>'validUntil')::date,notes=p->>'notes',lines=p->'lines',"updatedAt"=NEW."createdAt" WHERE id=o.id RETURNING * INTO o;
  ELSE
   INSERT INTO "SupplierOffer"(id,"rfqId","tenantId","companyId","branchId","supplierId","supplierBranchId","supplierName","supplierCode",version,"requestRevision",currency,"validUntil",notes,lines,"createdBy","createdAt","updatedAt") VALUES((p->>'offerId')::uuid,d.id,d."tenantId",d."companyId",d."branchId",s.id,s."branchId",s."displayName",s.code,1,d."requestRevision",p->>'currency',(p->>'validUntil')::date,p->>'notes',p->'lines',NEW."createdBy",NEW."createdAt",NEW."createdAt") RETURNING * INTO o;
  END IF;
  UPDATE "SupplierRfq" SET version=version+1,"updatedAt"=NEW."createdAt" WHERE id=d.id RETURNING * INTO d;
 ELSIF NEW.action='award' THEN
  IF NOT has_offer OR o."requestRevision"<>d."requestRevision" OR o.currency<>d.currency OR curr<>d.currency OR (o."validUntil" IS NOT NULL AND o."validUntil"<GREATEST((p->>'evaluationDate')::date,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date)) OR jsonb_array_length(o.lines)<>jsonb_array_length(d.lines) THEN RAISE EXCEPTION 'Complete current same-currency nonexpired offer required' USING ERRCODE='23514'; END IF;
  SELECT sum((r->>'quantity')::numeric*(q->>'unitPrice')::numeric) INTO total FROM jsonb_array_elements(d.lines) r JOIN jsonb_array_elements(o.lines) q ON r->>'position'=q->>'position';
  IF total IS NULL OR total>999999999999999.999 THEN RAISE EXCEPTION 'Purchase order total overflow' USING ERRCODE='23514'; END IF;
  INSERT INTO "PurchaseOrder"(id,"tenantId","companyId","branchId","supplierId",number,"supplierName",currency,subtotal,notes,status,"createdBy","createdAt") VALUES((p->>'purchaseOrderId')::uuid,d."tenantId",d."companyId",d."branchId",o."supplierId",p->>'purchaseOrderNumber',o."supplierName",o.currency,total,'RFQ '||d.id::text,'DRAFT',NEW."createdBy",NEW."createdAt") RETURNING * INTO po;
  INSERT INTO "PurchaseOrderLine"(id,"tenantId","orderId",position,description,quantity,"receivedQuantity","unitPrice",amount) SELECT gen_random_uuid(),d."tenantId",po.id,(r->>'position')::int,r->>'description',(r->>'quantity')::int,0,(q->>'unitPrice')::numeric,(r->>'quantity')::numeric*(q->>'unitPrice')::numeric FROM jsonb_array_elements(d.lines) r JOIN jsonb_array_elements(o.lines) q ON r->>'position'=q->>'position';
  SELECT (to_jsonb(po)-'issuedAt'-'receivedAt'-'cancelledAt')||jsonb_build_object('subtotal',po.subtotal::text,'createdAt',to_char(po."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'lines',(SELECT jsonb_agg((to_jsonb(pl)-'tenantId'-'orderId'-'receivedQuantity')||jsonb_build_object('unitPrice',pl."unitPrice"::text,'amount',pl.amount::text) ORDER BY pl.position) FROM "PurchaseOrderLine" pl WHERE pl."orderId"=po.id)) INTO po_json;
  UPDATE "SupplierRfq" SET status='AWARDED',"purchaseOrderId"=po.id,version=version+1,"updatedAt"=NEW."createdAt" WHERE id=d.id RETURNING * INTO d;
 END IF;
 stamp:=to_char(NEW."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 rfq_json:=to_jsonb(d)||jsonb_build_object('createdAt',to_char(d."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',stamp);
 IF NEW.action IN ('offer','award') THEN offer_json:=to_jsonb(o)||jsonb_build_object('createdAt',to_char(o."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(o."updatedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')); END IF;
 INSERT INTO "SupplierRfqRevision"(id,"requestId","rfqId","tenantId","companyId","branchId",version,action,"createdBy","createdAt",request,rfq,offer,"purchaseOrder") VALUES(gen_random_uuid(),NEW.id,d.id,d."tenantId",d."companyId",d."branchId",d.version,NEW.action,NEW."createdBy",NEW."createdAt",p,rfq_json,offer_json,po_json) RETURNING * INTO e;
 NEW.result:=to_jsonb(e)||jsonb_build_object('createdAt',stamp);
 RETURN NEW;
END $$;
CREATE TRIGGER apply_rfq_request BEFORE INSERT OR UPDATE OR DELETE ON "SupplierRfqRequest" FOR EACH ROW EXECUTE FUNCTION erp_apply_rfq_request();
CREATE FUNCTION erp_audit_rfq_request() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'supplier-rfq.'||lower(NEW.outcome),'SupplierRfqRequest',NEW.id::text,jsonb_build_object('outcome',NEW.outcome),NEW."createdAt");
 RETURN NEW;
END $$;
CREATE TRIGGER audit_rfq_request AFTER INSERT ON "SupplierRfqRequest" FOR EACH ROW EXECUTE FUNCTION erp_audit_rfq_request();
CREATE FUNCTION erp_guard_rfq_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity IN ('SupplierRfq','SupplierOffer','SupplierRfqRevision','SupplierRfqRequest') THEN RAISE EXCEPTION 'RFQ audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity IN ('SupplierRfq','SupplierOffer','SupplierRfqRevision','SupplierRfqRequest') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'RFQ audit is request-generated' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_rfq_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_rfq_audit();
CREATE FUNCTION erp_guard_rfq_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Durable RFQ history cannot be truncated' USING ERRCODE='23514'; END $$;
CREATE TRIGGER guard_rfq_truncate BEFORE TRUNCATE ON "SupplierRfq" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_rfq_truncate();
CREATE TRIGGER guard_offer_truncate BEFORE TRUNCATE ON "SupplierOffer" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_rfq_truncate();
CREATE TRIGGER guard_rfq_revision_truncate BEFORE TRUNCATE ON "SupplierRfqRevision" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_rfq_truncate();
CREATE TRIGGER guard_rfq_request_truncate BEFORE TRUNCATE ON "SupplierRfqRequest" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_rfq_truncate();
ALTER TABLE "SupplierRfq" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierRfqRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierRfqRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SupplierRfq","SupplierOffer","SupplierRfqRevision","SupplierRfqRequest" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_rfq_date(jsonb),erp_guard_rfq_projection(),erp_apply_rfq_request(),erp_audit_rfq_request(),erp_guard_rfq_audit(),erp_guard_rfq_truncate() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "SupplierRfq","SupplierOffer","SupplierRfqRevision","SupplierRfqRequest" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_rfq_date(jsonb),erp_guard_rfq_projection(),erp_apply_rfq_request(),erp_audit_rfq_request(),erp_guard_rfq_audit(),erp_guard_rfq_truncate() FROM %I',r);
END IF; END LOOP; END $$;
COMMIT;
