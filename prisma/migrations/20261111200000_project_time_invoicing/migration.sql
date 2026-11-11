BEGIN;
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "projectTimeSourceId" UUID;

-- CreateTable
CREATE TABLE "ProjectTimeInvoiceSource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "projectId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerName" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "entries" JSONB NOT NULL,
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

    CONSTRAINT "ProjectTimeInvoiceSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTimeInvoiceClaim" (
    "entryId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,

    CONSTRAINT "ProjectTimeInvoiceClaim_pkey" PRIMARY KEY ("entryId")
);

-- CreateTable
CREATE TABLE "ProjectTimeInvoiceRequest" (
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

    CONSTRAINT "ProjectTimeInvoiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTimeInvoiceSource_replacesSourceId_key" ON "ProjectTimeInvoiceSource"("replacesSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTimeInvoiceSource_requestId_key" ON "ProjectTimeInvoiceSource"("requestId");

-- CreateIndex
CREATE INDEX "ProjectTimeInvoiceSource_tenantId_companyId_projectId_creat_idx" ON "ProjectTimeInvoiceSource"("tenantId", "companyId", "projectId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTimeInvoiceSource_tenantId_companyId_id_key" ON "ProjectTimeInvoiceSource"("tenantId", "companyId", "id");

-- CreateIndex
CREATE INDEX "ProjectTimeInvoiceClaim_sourceId_idx" ON "ProjectTimeInvoiceClaim"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTimeInvoiceRequest_tenantId_companyId_id_key" ON "ProjectTimeInvoiceRequest"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_projectTimeSourceId_key" ON "Invoice"("projectTimeSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_companyId_projectTimeSourceId_key" ON "Invoice"("tenantId", "companyId", "projectTimeSourceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_companyId_projectTimeSourceId_fkey" FOREIGN KEY ("tenantId", "companyId", "projectTimeSourceId") REFERENCES "ProjectTimeInvoiceSource"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice" DROP CONSTRAINT invoice_exactly_one_source;
ALTER TABLE "Invoice" ADD CONSTRAINT invoice_exactly_one_source CHECK (num_nonnulls("orderId","serviceSourceId","projectTimeSourceId")=1);
DO $$ DECLARE t TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['ProjectTimeInvoiceSource','ProjectTimeInvoiceRequest','ProjectTimeInvoiceClaim'] LOOP
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","projectId") REFERENCES "Project"("tenantId","companyId",id) ON DELETE RESTRICT',t);
 IF t<>'ProjectTimeInvoiceClaim' THEN
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT',t);
 EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY ("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT',t);
 END IF;
 END LOOP;
END $$;
ALTER TABLE "ProjectTimeInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectTimeInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","requestId") REFERENCES "ProjectTimeInvoiceRequest"("tenantId","companyId",id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "ProjectTimeInvoiceSource" ADD FOREIGN KEY ("tenantId","companyId","replacesSourceId") REFERENCES "ProjectTimeInvoiceSource"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectTimeInvoiceClaim" ADD FOREIGN KEY ("tenantId","companyId","projectId","entryId") REFERENCES "ProjectTimeEntry"("tenantId","companyId","projectId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectTimeInvoiceClaim" ADD FOREIGN KEY ("tenantId","companyId","sourceId") REFERENCES "ProjectTimeInvoiceSource"("tenantId","companyId",id) ON DELETE RESTRICT;
ALTER TABLE "ProjectTimeInvoiceRequest" ADD CHECK(outcome IN ('COMMITTED','ABANDONED') AND jsonb_typeof(request)='object');
ALTER TABLE "ProjectTimeInvoiceSource" ADD CHECK(currency~'^[A-Z]{3}$' AND subtotal>=0 AND "taxAmount">=0 AND length(btrim(reason)) BETWEEN 3 AND 300 AND ("paymentTerms" IS NULL OR length(btrim("paymentTerms")) BETWEEN 3 AND 120) AND ("paymentDueDate" IS NULL OR "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'));
INSERT INTO "Permission"(key) VALUES('project-time-invoice:read'),('project-time-invoice:generate') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('project-time-invoice:read'),('project-time-invoice:generate')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
CREATE FUNCTION erp_time_invoice_history() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Project time invoice history and claims are immutable' USING ERRCODE='23514';END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Project time billing requires READ COMMITTED' USING ERRCODE='23514';END IF;
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM id FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF TG_TABLE_NAME='ProjectTimeInvoiceSource' THEN PERFORM id FROM "Customer" WHERE id=(to_jsonb(NEW)->>'customerId')::uuid FOR SHARE;END IF;
 PERFORM id FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 NEW."createdAt":=clock_timestamp() AT TIME ZONE 'UTC';NEW."creationTransaction":=txid_current()::text;RETURN NEW;
END $$;
DO $$ DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['ProjectTimeInvoiceSource','ProjectTimeInvoiceClaim','ProjectTimeInvoiceRequest'] LOOP
 EXECUTE format('CREATE TRIGGER time_invoice_history BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_history()',t);
END LOOP;END $$;
CREATE FUNCTION erp_time_invoice_reversed(invoice_id UUID) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Invoice" i WHERE i.id=invoice_id AND i.status='VOID')
 AND NOT EXISTS(SELECT 1 FROM "JournalEntry" j WHERE (j.number=erp_billing_invoice_journal(invoice_id) OR EXISTS(SELECT 1 FROM "AuditLog" a WHERE a.entity='Invoice' AND a."entityId"=invoice_id::text AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=j.id::text)) AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id))
 AND NOT EXISTS(SELECT 1 FROM "CustomerSettlement" cs JOIN "JournalEntry" j ON j.id=cs."entryId" WHERE cs."invoiceId"=invoice_id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id));
$$;
CREATE FUNCTION erp_time_invoice_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source "ProjectTimeInvoiceSource"%ROWTYPE;
BEGIN
 -- Preserve the historical order contract. Existing service invoices only gain
 -- the same terminal-VOID rule already enforced by their API; no82 rewrite.
 IF NEW."projectTimeSourceId" IS NULL THEN
 IF NEW."serviceSourceId" IS NOT NULL AND TG_OP='UPDATE' AND OLD.status='VOID' AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'VOID service invoice is terminal; use explicit replacement' USING ERRCODE='23514';END IF;
 RETURN NEW;
 END IF;
 SELECT * INTO source FROM "ProjectTimeInvoiceSource" WHERE id=NEW."projectTimeSourceId";
 PERFORM id FROM "Project" WHERE id=source."projectId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
 IF NEW.status<>'DRAFT' OR NEW."issuedAt" IS NOT NULL OR NEW."voidedAt" IS NOT NULL OR NEW."voidReason" IS NOT NULL THEN RAISE EXCEPTION 'Project invoices begin as genuine drafts' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.status=OLD.status THEN
 IF (NEW."issuedAt",NEW."voidedAt",NEW."voidReason") IS DISTINCT FROM (OLD."issuedAt",OLD."voidedAt",OLD."voidReason") THEN RAISE EXCEPTION 'Invoice lifecycle dates immutable without transition' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF OLD.status='VOID' OR NEW.status='DRAFT' THEN RAISE EXCEPTION 'VOID project invoice is terminal; use explicit replacement' USING ERRCODE='23514';END IF;
 IF NEW.status='ISSUED' THEN
 IF OLD.status<>'DRAFT' OR NEW."issuedAt" IS NULL OR NEW."voidedAt" IS NOT NULL OR NEW."voidReason" IS NOT NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(source.entries) x LEFT JOIN "ProjectTimeEntry" e ON e.id=(x->>'entryId')::uuid WHERE e.id IS NULL OR e."voidedAt" IS NOT NULL OR e."reviewState"<>'APPROVED' OR e."reviewSequence"<>(x->>'reviewSequence')::integer) THEN RAISE EXCEPTION 'Issue requires still-approved original time' USING ERRCODE='23514';END IF;
 ELSE
 IF NEW."voidedAt" IS NULL OR length(btrim(coalesce(NEW."voidReason",'')))<3 OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR EXISTS(SELECT 1 FROM "JournalEntry" j WHERE (j.number=erp_billing_invoice_journal(OLD.id) OR EXISTS(SELECT 1 FROM "AuditLog" a WHERE a.entity='Invoice' AND a."entityId"=OLD.id::text AND a.action='invoice.ledger_posted' AND a.metadata->>'journalId'=j.id::text)) AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id)) OR EXISTS(SELECT 1 FROM "CustomerSettlement" cs JOIN "JournalEntry" j ON j.id=cs."entryId" WHERE cs."invoiceId"=OLD.id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=j.id)) THEN RAISE EXCEPTION 'Void requires reversed financial dependencies and reason' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER time_invoice_status_guard BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_status_guard();
CREATE FUNCTION erp_time_invoice_entry_correction() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM id FROM "Project" WHERE id=OLD."projectId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "ProjectTimeInvoiceClaim" WHERE "entryId"=OLD.id) AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s JOIN "Invoice" i ON i."projectTimeSourceId"=s.id WHERE s.entries @> jsonb_build_array(jsonb_build_object('entryId',OLD.id)) AND NOT erp_time_invoice_reversed(i.id)) THEN RAISE EXCEPTION 'Reverse and VOID all billed invoices before resetting or voiding claimed time' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER time_invoice_entry_correction BEFORE UPDATE ON "ProjectTimeEntry" FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_entry_correction();
CREATE FUNCTION erp_time_invoice_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE p "Project"%ROWTYPE;c "Customer"%ROWTYPE;r "ProjectTimeInvoiceRequest"%ROWTYPE;i "Invoice"%ROWTYPE;v "CompanyVatProfile"%ROWTYPE;old_s "ProjectTimeInvoiceSource"%ROWTYPE;e "ProjectTimeEntry"%ROWTYPE;chosen JSONB;actual JSONB;expected_entries JSONB:='[]';price_lines JSONB:='[]';prices JSONB;taxable BOOLEAN;net NUMERIC;permission TEXT;prior UUID;root_id UUID;visited UUID[]:=ARRAY[]::UUID[];
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 SELECT * INTO c FROM "Customer" WHERE id=NEW."customerId" FOR SHARE;
 SELECT * INTO r FROM "ProjectTimeInvoiceRequest" WHERE id=NEW."requestId";
 SELECT * INTO i FROM "Invoice" WHERE "projectTimeSourceId"=NEW.id;
 SELECT * INTO v FROM "CompanyVatProfile" WHERE "companyId"=NEW."companyId";
 taxable:=coalesce(v.enabled AND v."effectiveFrom"<=NEW."createdAt"::date,false);
 IF p.id IS NULL OR c.id IS NULL OR r.id IS NULL OR i.id IS NULL OR r.outcome<>'COMMITTED' OR r."creationTransaction"<>NEW."creationTransaction" OR i."creationTransaction"<>NEW."creationTransaction" OR NEW."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Project invoice requires same-transaction request and draft invoice' USING ERRCODE='23514';END IF;
 IF (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR p.status='CANCELLED' AND NEW."replacesSourceId" IS NULL OR c."archivedAt" IS NOT NULL OR (c."tenantId",c."companyId",c."displayName") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."customerName") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId" OR (r."tenantId",r."companyId",r."branchId",r."projectId",r."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",NEW."createdBy") THEN RAISE EXCEPTION 'Current project/customer scope mismatch' USING ERRCODE='23514';END IF;
 FOREACH permission IN ARRAY ARRAY['project:read','project-time:read','project-time-invoice:read','project-time-invoice:generate','project-billing:read','project-billing:manage','invoice:read','invoice:create'] LOOP
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current time invoice permission required: %',permission USING ERRCODE='23514';END IF;END LOOP;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Current customer read required' USING ERRCODE='23514';END IF;
 IF (NEW."customerId",NEW.currency,NEW."paymentTerms",NEW."paymentDueDate",NEW."replacesSourceId",NEW.reason) IS DISTINCT FROM ((r.request->>'customerId')::uuid,r.request->>'currency',r.request->>'paymentTerms',(r.request->>'paymentDueDate')::date,(r.request->>'replacesSourceId')::uuid,r.request->>'reason') THEN RAISE EXCEPTION 'Time source differs from explicit request' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(r.request->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(r.request->'entries') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'entryId') FROM jsonb_array_elements(r.request->'entries') x)<>jsonb_array_length(r.request->'entries') THEN RAISE EXCEPTION 'Unique selected time required' USING ERRCODE='23514';END IF;
 FOR chosen IN SELECT value FROM jsonb_array_elements(r.request->'entries') ORDER BY value->>'entryId' LOOP
 SELECT * INTO e FROM "ProjectTimeEntry" WHERE id=(chosen->>'entryId')::uuid AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "projectId"=NEW."projectId";
 IF e.id IS NULL OR e."voidedAt" IS NOT NULL OR e."reviewState"<>'APPROVED' OR e."reviewSequence" IS DISTINCT FROM (chosen->>'expectedSequence')::integer OR chosen IS DISTINCT FROM jsonb_build_object('entryId',e.id,'expectedSequence',e."reviewSequence",'hourlyRate',chosen->'hourlyRate','treatment',chosen->'treatment') OR jsonb_typeof(chosen->'hourlyRate') IS DISTINCT FROM 'string' OR chosen->>'hourlyRate' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR chosen->>'treatment' IS NULL OR chosen->>'treatment' NOT IN ('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Current approved time and exact selected rates required' USING ERRCODE='23514';END IF;
 actual:=jsonb_build_object('entryId',e.id,'minutes',e.minutes,'description',e.description,'workDate',to_char(e."workDate",'YYYY-MM-DD'),'reviewSequence',e."reviewSequence",'hourlyRate',chosen->'hourlyRate','treatment',chosen->'treatment');expected_entries:=expected_entries||jsonb_build_array(actual);
 net:=round(e.minutes*(chosen->>'hourlyRate')::numeric/60,3);
 price_lines:=price_lines||jsonb_build_array(jsonb_build_object('description',e.description||' ('||(e.minutes/60)::text||'h '||(e.minutes%60)::text||'m @ '||(chosen->>'hourlyRate')||' '||NEW.currency||'/h; one time record)','quantity',1,'unitPrice',to_char(net,'FM999999999999999990.000'),'treatment',chosen->'treatment'));
 END LOOP;
 IF NEW.entries IS DISTINCT FROM expected_entries THEN RAISE EXCEPTION 'Immutable original time snapshot required' USING ERRCODE='23514';END IF;
 IF r.request->>'previewHash' IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('actorId',NEW."createdBy",'projectId',p.id,'projectName',p.name,'projectStatus',p.status,'customerId',c.id,'customerName',c."displayName",'customerBranchId',c."branchId",'entries',expected_entries,'currency',NEW.currency,'paymentTerms',NEW."paymentTerms",'paymentDueDate',CASE WHEN NEW."paymentDueDate" IS NULL THEN NULL ELSE to_char(NEW."paymentDueDate",'YYYY-MM-DD') END,'replacesSourceId',NEW."replacesSourceId",'invoiceDate',to_char(NEW."createdAt",'YYYY-MM-DD'),'vatProfileRevision',v.revision,'vatProfile',CASE WHEN v."companyId" IS NULL THEN NULL ELSE to_jsonb(v) END)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Current canonical time, customer, price and VAT fingerprint required' USING ERRCODE='23514';END IF;
 prices:=erp_billing_prices(price_lines,taxable);
 IF NEW.lines IS DISTINCT FROM prices->'lines' OR NEW.subtotal IS DISTINCT FROM (prices->>'subtotal')::numeric OR NEW."taxAmount" IS DISTINCT FROM (prices->>'taxAmount')::numeric OR NEW."vatProfileRevision" IS DISTINCT FROM (CASE WHEN taxable THEN v.revision ELSE NULL END) OR taxable AND NEW.currency<>'OMR' THEN RAISE EXCEPTION 'Exact time prices and invoice-date tax required' USING ERRCODE='23514';END IF;
 IF NEW."replacesSourceId" IS NOT NULL THEN
 SELECT * INTO old_s FROM "ProjectTimeInvoiceSource" WHERE id=NEW."replacesSourceId";
 SELECT id INTO prior FROM "Invoice" WHERE "projectTimeSourceId"=old_s.id FOR UPDATE;
 IF old_s.id IS NULL OR NOT erp_time_invoice_reversed(prior) OR (old_s."tenantId",old_s."companyId",old_s."branchId",old_s."projectId",old_s."customerId",old_s.currency) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."projectId",NEW."customerId",NEW.currency) OR (SELECT jsonb_agg(x->>'entryId' ORDER BY x->>'entryId') FROM jsonb_array_elements(old_s.entries) x) IS DISTINCT FROM (SELECT jsonb_agg(x->>'entryId' ORDER BY x->>'entryId') FROM jsonb_array_elements(NEW.entries) x) THEN RAISE EXCEPTION 'Explicit replacement needs reversed VOID source and same entitlements' USING ERRCODE='23514';END IF;
 root_id:=old_s.id;
 LOOP
 IF root_id=ANY(visited) THEN RAISE EXCEPTION 'Cyclic correction source' USING ERRCODE='23514';END IF;visited:=array_append(visited,root_id);
 SELECT "replacesSourceId" INTO prior FROM "ProjectTimeInvoiceSource" WHERE id=root_id;
 EXIT WHEN prior IS NULL;root_id:=prior;
 END LOOP;
 ELSE root_id:=NEW.id;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.entries) x WHERE NOT EXISTS(SELECT 1 FROM "ProjectTimeInvoiceClaim" cl WHERE cl."entryId"=(x->>'entryId')::uuid AND cl."sourceId"=root_id AND cl."projectId"=NEW."projectId")) OR NEW."replacesSourceId" IS NULL AND (SELECT count(*) FROM "ProjectTimeInvoiceClaim" WHERE "sourceId"=NEW.id)<>jsonb_array_length(NEW.entries) THEN RAISE EXCEPTION 'Permanent unique time claims required' USING ERRCODE='23514';END IF;
 IF i.number IS DISTINCT FROM 'PT-'||substr(erp_billing_invoice_journal(NEW.id),6) OR i.status<>'DRAFT' OR (i."tenantId",i."companyId",i."branchId",i."customerId",i."customerName",i.currency,i.subtotal,i."paymentTerms",i."paymentDueDate",i."createdBy") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."customerName",NEW.currency,NEW.subtotal,NEW."paymentTerms",NEW."paymentDueDate",NEW."createdBy") THEN RAISE EXCEPTION 'Draft invoice must match project source' USING ERRCODE='23514';END IF;
 IF (SELECT coalesce(jsonb_agg(jsonb_build_object('position',l.position,'description',l.description,'quantity',l.quantity,'unitPrice',to_char(l."unitPrice",'FM999999999999999990.000'),'amount',to_char(l.amount,'FM999999999999999990.000')) ORDER BY l.position),'[]'::jsonb) FROM "InvoiceLine" l WHERE l."invoiceId"=i.id) IS DISTINCT FROM (SELECT jsonb_agg(x-ARRAY['treatment','tax'] ORDER BY (x->>'position')::integer) FROM jsonb_array_elements(NEW.lines) x) THEN RAISE EXCEPTION 'Time invoice line parity required' USING ERRCODE='23514';END IF;
 IF taxable THEN
 IF NOT EXISTS(SELECT 1 FROM "InvoiceVat" iv WHERE iv."invoiceId"=i.id AND iv."taxAmount"=NEW."taxAmount" AND iv.details=(SELECT jsonb_agg(jsonb_build_object('position',(x->>'position')::integer,'treatment',x->>'treatment','net',x->>'amount','tax',x->>'tax') ORDER BY (x->>'position')::integer) FROM jsonb_array_elements(NEW.lines) x)) THEN RAISE EXCEPTION 'Time VAT classification mismatch' USING ERRCODE='23514';END IF;
 ELSIF EXISTS(SELECT 1 FROM "InvoiceVat" WHERE "invoiceId"=i.id) THEN RAISE EXCEPTION 'Inactive VAT cannot have tax record' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "ProjectInvoiceLink" l WHERE l."invoiceId"=i.id AND l."projectId"=NEW."projectId" AND l."createdBy"=NEW."createdBy" AND l.note=NEW.reason AND l."creationTransaction"=NEW."creationTransaction" AND l."unlinkedAt" IS NULL) THEN RAISE EXCEPTION 'Immutable automatic project link required' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity='Invoice' AND a.action='invoice.created' AND a."entityId"=i.id::text AND a.metadata=jsonb_build_object('projectTimeSourceId',NEW.id,'projectId',NEW."projectId",'requestId',NEW."requestId")) THEN RAISE EXCEPTION 'Request-generated invoice creation audit required' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER time_invoice_complete AFTER INSERT ON "ProjectTimeInvoiceSource" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_complete();
CREATE FUNCTION erp_time_invoice_claim_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s WHERE s.id=NEW."sourceId" AND s."projectId"=NEW."projectId" AND s."creationTransaction"=NEW."creationTransaction" AND s."replacesSourceId" IS NULL AND s.entries @> jsonb_build_array(jsonb_build_object('entryId',NEW."entryId"))) THEN RAISE EXCEPTION 'Claim must belong to same-transaction original source' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER time_invoice_claim_complete AFTER INSERT ON "ProjectTimeInvoiceClaim" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_claim_complete();
CREATE FUNCTION erp_time_invoice_request_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE c "Customer"%ROWTYPE;p "Project"%ROWTYPE;s "ProjectTimeInvoiceSource"%ROWTYPE;i "Invoice"%ROWTYPE;expected JSONB;permission TEXT;chosen JSONB;
BEGIN
 SELECT * INTO p FROM "Project" WHERE id=NEW."projectId" FOR UPDATE;
 SELECT * INTO c FROM "Customer" WHERE id=(NEW.request->>'customerId')::uuid FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('project-time-invoice:'||NEW.id::text,0));
 expected:=jsonb_build_object('tenantId',NEW."tenantId",'companyId',NEW."companyId",'branchId',NEW."branchId",'projectId',NEW."projectId",'expectedActorId',NEW."createdBy",'customerId',NEW.request->'customerId','currency',NEW.request->'currency','entries',NEW.request->'entries','paymentTerms',NEW.request->'paymentTerms','paymentDueDate',NEW.request->'paymentDueDate','replacesSourceId',NEW.request->'replacesSourceId','requestId',NEW.id,'previewHash',NEW.request->'previewHash','reason',NEW.request->'reason');
 IF NEW.request IS DISTINCT FROM expected OR NEW.request->>'previewHash' IS NULL OR NEW.request->>'previewHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(NEW.request->'reason') IS DISTINCT FROM 'string' OR length(btrim(NEW.request->>'reason')) NOT BETWEEN 3 AND 300 OR (NEW.request->>'reason')~'[[:cntrl:]]' OR p.id IS NULL OR c.id IS NULL OR (p."tenantId",p."companyId",p."branchId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."branchId") OR (c."tenantId",c."companyId") IS DISTINCT FROM (NEW."tenantId",NEW."companyId") OR c."branchId" IS NOT NULL AND c."branchId" IS DISTINCT FROM NEW."branchId" THEN RAISE EXCEPTION 'Canonical actor-bound request with current scope required' USING ERRCODE='23514';END IF;
 FOREACH permission IN ARRAY ARRAY['project:read','project-time:read','project-time-invoice:read','project-time-invoice:generate','project-billing:read','project-billing:manage','invoice:read','invoice:create'] LOOP
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",permission) THEN RAISE EXCEPTION 'Current request permission required' USING ERRCODE='23514';END IF;END LOOP;
 IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",c."branchId",'customer:read') THEN RAISE EXCEPTION 'Customer authorization required' USING ERRCODE='23514';END IF;
 IF (NEW.request->'paymentTerms'='null'::jsonb) IS DISTINCT FROM (NEW.request->'paymentDueDate'='null'::jsonb) OR jsonb_typeof(NEW.request->'currency') IS DISTINCT FROM 'string' OR NEW.request->>'currency' !~ '^[A-Z]{3}$' OR (NEW.request->'paymentTerms'<>'null'::jsonb AND (jsonb_typeof(NEW.request->'paymentTerms') IS DISTINCT FROM 'string' OR length(btrim(NEW.request->>'paymentTerms')) NOT BETWEEN 3 AND 120 OR NEW.request->>'paymentTerms' ~ '[[:cntrl:]]')) OR (NEW.request->'paymentDueDate'<>'null'::jsonb AND (jsonb_typeof(NEW.request->'paymentDueDate') IS DISTINCT FROM 'string' OR NEW.request->>'paymentDueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (NEW.request->>'paymentDueDate')::date NOT BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')) OR (NEW.request->'replacesSourceId'<>'null'::jsonb AND (NEW.request->>'replacesSourceId')::uuid IS NULL) THEN RAISE EXCEPTION 'Explicit valid currency and terms required' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(NEW.request->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.request->'entries') NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'entryId') FROM jsonb_array_elements(NEW.request->'entries') x)<>jsonb_array_length(NEW.request->'entries') THEN RAISE EXCEPTION 'Unique bounded request entries required' USING ERRCODE='23514';END IF;
 FOR chosen IN SELECT value FROM jsonb_array_elements(NEW.request->'entries') LOOP
 IF chosen IS DISTINCT FROM jsonb_build_object('entryId',(chosen->>'entryId')::uuid,'expectedSequence',chosen->'expectedSequence','hourlyRate',chosen->'hourlyRate','treatment',chosen->'treatment') OR (chosen->>'entryId')::uuid IS NULL OR jsonb_typeof(chosen->'expectedSequence') IS DISTINCT FROM 'number' OR chosen->>'expectedSequence' !~ '^[1-9][0-9]*$' OR (chosen->>'expectedSequence')::integer NOT BETWEEN 1 AND 1000 OR jsonb_typeof(chosen->'hourlyRate') IS DISTINCT FROM 'string' OR chosen->>'hourlyRate' !~ '^(0|[1-9][0-9]{0,14})\.[0-9]{3}$' OR chosen->>'treatment' IS NULL OR chosen->>'treatment' NOT IN ('STANDARD','ZERO','EXEMPT') THEN RAISE EXCEPTION 'Exact request entry fields required' USING ERRCODE='23514';END IF;
 END LOOP;
 SELECT * INTO s FROM "ProjectTimeInvoiceSource" WHERE "requestId"=NEW.id;
 IF NEW.outcome='ABANDONED' THEN
 IF s.id IS NOT NULL OR NEW.result<>jsonb_build_object('kind','abandoned') THEN RAISE EXCEPTION 'Abandoned request cannot produce a source' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO i FROM "Invoice" WHERE "projectTimeSourceId"=s.id;
 IF s.id IS NULL OR i.id IS NULL OR NEW.result IS DISTINCT FROM jsonb_build_object('kind','invoice','projectTimeSourceId',s.id,'invoice',jsonb_build_object('id',i.id,'number',i.number,'status','DRAFT')) THEN RAISE EXCEPTION 'Exact committed time invoice receipt required' USING ERRCODE='23514';END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER time_invoice_request_complete AFTER INSERT ON "ProjectTimeInvoiceRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_request_complete();
CREATE FUNCTION erp_time_invoice_request_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'project-time-invoice.'||lower(NEW.outcome),'ProjectTimeInvoiceRequest',NEW.id::text,jsonb_build_object('projectId',NEW."projectId",'outcome',NEW.outcome),NEW."createdAt");
 IF NEW.outcome='COMMITTED' THEN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") SELECT gen_random_uuid(),NEW."tenantId",NEW."createdBy",'invoice.created','Invoice',i.id::text,jsonb_build_object('projectTimeSourceId',s.id,'projectId',NEW."projectId",'requestId',NEW.id),NEW."createdAt" FROM "ProjectTimeInvoiceSource" s JOIN "Invoice" i ON i."projectTimeSourceId"=s.id WHERE s."requestId"=NEW.id;
 END IF;
 RETURN NEW;END $$;
CREATE TRIGGER time_invoice_request_audit AFTER INSERT ON "ProjectTimeInvoiceRequest" FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_request_audit();
CREATE FUNCTION erp_time_invoice_audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND (OLD.entity='ProjectTimeInvoiceRequest' OR OLD.entity='Invoice' AND OLD.action='invoice.created' AND (OLD.metadata ? 'projectTimeSourceId' OR EXISTS(SELECT 1 FROM "Invoice" WHERE id::text=OLD."entityId" AND "projectTimeSourceId" IS NOT NULL)) OR OLD.entity='ProjectInvoiceLink' AND EXISTS(SELECT 1 FROM "ProjectInvoiceLink" l JOIN "Invoice" i ON i.id=l."invoiceId" WHERE l.id::text=OLD."entityId" AND i."projectTimeSourceId" IS NOT NULL)) THEN RAISE EXCEPTION 'Time invoice audit immutable' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 IF (NEW.entity='ProjectTimeInvoiceRequest' OR NEW.entity='Invoice' AND NEW.action='invoice.created' AND (NEW.metadata ? 'projectTimeSourceId' OR EXISTS(SELECT 1 FROM "Invoice" WHERE id::text=NEW."entityId" AND "projectTimeSourceId" IS NOT NULL))) AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Time invoice audit is request generated' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER time_invoice_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_audit_guard();
CREATE OR REPLACE FUNCTION erp_invoice_source_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s "ServiceInvoiceSource"%ROWTYPE;p "ProjectTimeInvoiceSource"%ROWTYPE;
BEGIN
 IF NEW."orderId" IS NOT NULL THEN
 IF NOT EXISTS(SELECT 1 FROM "SalesOrder" o WHERE o.id=NEW."orderId" AND o."tenantId"=NEW."tenantId" AND o."companyId"=NEW."companyId" AND o.status='COMPLETED') THEN RAISE EXCEPTION 'New order invoice requires completed real sales order' USING ERRCODE='23514';END IF;
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
 IF parent.status NOT IN('PLANNED','ACTIVE','ON_HOLD') AND NOT (TG_OP='INSERT' AND source."projectTimeSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s WHERE s.id=source."projectTimeSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text AND (parent.status='COMPLETED' OR parent.status='CANCELLED' AND s."replacesSourceId" IS NOT NULL))) THEN RAISE EXCEPTION 'Closed projects allow only authorized generated time billing, not manual reassignment' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NOT (source.status='ISSUED' OR source.status='DRAFT' AND source."projectTimeSourceId" IS NOT NULL AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" s WHERE s.id=source."projectTimeSourceId" AND s."projectId"=NEW."projectId" AND s."createdBy"=NEW."createdBy" AND s."creationTransaction"=txid_current()::text)) OR NEW."unlinkRequestId" IS NOT NULL OR NEW."unlinkedBy" IS NOT NULL OR NEW."unlinkedAt" IS NOT NULL OR NEW."unlinkReason" IS NOT NULL OR NEW."unlinkTransaction" IS NOT NULL THEN RAISE EXCEPTION 'Link requires an issued invoice and active initial state' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM "ProjectInvoiceLink" WHERE "invoiceId"=source.id AND "unlinkedAt" IS NULL) THEN RAISE EXCEPTION 'Invoice already belongs to an active project link' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM "ProjectInvoiceLink" WHERE "tenantId"=NEW."tenantId" AND "projectId"=NEW."projectId")>=1000 THEN RAISE EXCEPTION 'Project invoice history limit reached' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();NEW."creationTransaction":=txid_current()::text;actor:=NEW."createdBy";
 ELSE
  IF source."projectTimeSourceId" IS NOT NULL THEN RAISE EXCEPTION 'Generated time invoice project link is permanent' USING ERRCODE='23514';END IF;
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."projectId",NEW."invoiceId",NEW.note,NEW."createdBy",NEW."createdAt",NEW."creationTransaction") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."projectId",OLD."invoiceId",OLD.note,OLD."createdBy",OLD."createdAt",OLD."creationTransaction") OR OLD."unlinkedAt" IS NOT NULL OR NEW."unlinkRequestId" IS NULL OR NEW."unlinkedBy" IS NULL OR NEW."unlinkReason" IS NULL THEN RAISE EXCEPTION 'Only one permanent project invoice unlink is allowed' USING ERRCODE='23514';END IF;
  NEW."unlinkedAt":=clock_timestamp();NEW."unlinkTransaction":=txid_current()::text;actor:=NEW."unlinkedBy";
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Project billing requires an active scoped actor' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER time_invoice_link_no_truncate BEFORE TRUNCATE ON "ProjectInvoiceLink" FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate();
CREATE FUNCTION erp_time_invoice_customer_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "ProjectTimeInvoiceSource" WHERE "customerId"=OLD.id) THEN RAISE EXCEPTION 'Time invoice customer scope immutable' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER time_invoice_customer_scope BEFORE UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION erp_time_invoice_customer_scope();
DO $$ DECLARE t TEXT;r TEXT;f TEXT;BEGIN
 FOREACH t IN ARRAY ARRAY['ProjectTimeInvoiceSource','ProjectTimeInvoiceClaim','ProjectTimeInvoiceRequest'] LOOP
 EXECUTE format('CREATE TRIGGER time_invoice_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION erp_guard_manual_subscription_truncate()',t);
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r);END IF;END LOOP;
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE 'erp_time_invoice_%' OR proname IN ('erp_invoice_source_insert','erp_project_invoice_guard')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,r);END IF;END LOOP;
 END LOOP;
END $$;
COMMIT;
