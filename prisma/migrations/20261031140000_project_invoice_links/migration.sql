CREATE TABLE "ProjectInvoiceLink" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"projectId" UUID NOT NULL,"invoiceId" UUID NOT NULL,
 note VARCHAR(300) NOT NULL CHECK(length(trim(note)) BETWEEN 3 AND 300),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"creationTransaction" TEXT NOT NULL DEFAULT(txid_current())::text,
 "unlinkRequestId" UUID UNIQUE,"unlinkedBy" UUID,"unlinkedAt" TIMESTAMPTZ(3),"unlinkReason" VARCHAR(300),"unlinkTransaction" TEXT,
 FOREIGN KEY("tenantId","companyId","projectId") REFERENCES "Project"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","invoiceId") REFERENCES "Invoice"("tenantId","companyId",id) ON DELETE RESTRICT,
 CHECK(("unlinkRequestId" IS NULL AND "unlinkedBy" IS NULL AND "unlinkedAt" IS NULL AND "unlinkReason" IS NULL AND "unlinkTransaction" IS NULL) OR ("unlinkRequestId" IS NOT NULL AND "unlinkedBy" IS NOT NULL AND "unlinkedAt" IS NOT NULL AND "unlinkReason" IS NOT NULL AND length(trim("unlinkReason")) BETWEEN 3 AND 300 AND "unlinkTransaction" IS NOT NULL))
);
CREATE UNIQUE INDEX "ProjectInvoiceLink_active_invoice_key" ON "ProjectInvoiceLink"("invoiceId") WHERE "unlinkedAt" IS NULL;
CREATE INDEX "ProjectInvoiceLink_tenantId_projectId_createdAt_id_idx" ON "ProjectInvoiceLink"("tenantId","projectId","createdAt",id);
CREATE INDEX "ProjectInvoiceLink_invoiceId_unlinkedAt_idx" ON "ProjectInvoiceLink"("invoiceId","unlinkedAt");
CREATE FUNCTION erp_project_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent RECORD; source RECORD; actor UUID;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Project invoice history cannot be deleted' USING ERRCODE='23514';END IF;
 SELECT * INTO parent FROM "Project" WHERE id=NEW."projectId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL OR parent.status NOT IN('PLANNED','ACTIVE','ON_HOLD') THEN RAISE EXCEPTION 'Project is closed or unavailable for invoice changes' USING ERRCODE='23514';END IF;
 SELECT * INTO source FROM "Invoice" WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF source.id IS NULL OR (parent."branchId" IS NOT NULL AND source."branchId" IS DISTINCT FROM parent."branchId") THEN RAISE EXCEPTION 'Invoice is outside project scope' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF source.status<>'ISSUED' OR NEW."unlinkRequestId" IS NOT NULL OR NEW."unlinkedBy" IS NOT NULL OR NEW."unlinkedAt" IS NOT NULL OR NEW."unlinkReason" IS NOT NULL OR NEW."unlinkTransaction" IS NOT NULL THEN RAISE EXCEPTION 'Link requires an issued invoice and active initial state' USING ERRCODE='23514';END IF;
  IF EXISTS(SELECT 1 FROM "ProjectInvoiceLink" WHERE "invoiceId"=source.id AND "unlinkedAt" IS NULL) THEN RAISE EXCEPTION 'Invoice already belongs to an active project link' USING ERRCODE='23514';END IF;
  IF (SELECT count(*) FROM "ProjectInvoiceLink" WHERE "tenantId"=NEW."tenantId" AND "projectId"=NEW."projectId")>=1000 THEN RAISE EXCEPTION 'Project invoice history limit reached' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();NEW."creationTransaction":=txid_current()::text;actor:=NEW."createdBy";
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."projectId",NEW."invoiceId",NEW.note,NEW."createdBy",NEW."createdAt",NEW."creationTransaction") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."projectId",OLD."invoiceId",OLD.note,OLD."createdBy",OLD."createdAt",OLD."creationTransaction") OR OLD."unlinkedAt" IS NOT NULL OR NEW."unlinkRequestId" IS NULL OR NEW."unlinkedBy" IS NULL OR NEW."unlinkReason" IS NULL THEN RAISE EXCEPTION 'Only one permanent project invoice unlink is allowed' USING ERRCODE='23514';END IF;
  NEW."unlinkedAt":=clock_timestamp();NEW."unlinkTransaction":=txid_current()::text;actor:=NEW."unlinkedBy";
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Project billing requires an active scoped actor' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON "ProjectInvoiceLink" FOR EACH ROW EXECUTE FUNCTION erp_project_invoice_guard();
CREATE FUNCTION erp_project_invoice_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE action_name TEXT;actor UUID;txn TEXT;request_id UUID;
BEGIN
 IF TG_OP='INSERT' THEN action_name:='project-invoice.linked';actor:=NEW."createdBy";txn:=NEW."creationTransaction";request_id:=NEW.id;
 ELSE action_name:='project-invoice.unlinked';actor:=NEW."unlinkedBy";txn:=NEW."unlinkTransaction";request_id:=NEW."unlinkRequestId";END IF;
 IF txn<>txid_current()::text OR NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=actor AND a.entity='ProjectInvoiceLink' AND a."entityId"=NEW.id::text AND a.action=action_name AND a.metadata->>'parentId'=NEW."projectId"::text AND a.metadata->>'requestId'=request_id::text AND a.metadata->>'transaction'=txn) THEN RAISE EXCEPTION 'Project invoice change requires same-transaction audit' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER project_invoice_audit AFTER INSERT OR UPDATE ON "ProjectInvoiceLink" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_project_invoice_audit();
CREATE FUNCTION erp_project_invoice_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='Project' THEN
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "ProjectInvoiceLink" WHERE "projectId"=OLD.id) THEN RAISE EXCEPTION 'Project billing source scope is immutable' USING ERRCODE='23514';END IF;
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."orderId",NEW."customerId",NEW.currency,NEW.subtotal) IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."orderId",OLD."customerId",OLD.currency,OLD.subtotal) AND EXISTS(SELECT 1 FROM "ProjectInvoiceLink" WHERE "invoiceId"=OLD.id) THEN RAISE EXCEPTION 'Linked invoice financial source is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER project_invoice_project_scope BEFORE UPDATE ON "Project" FOR EACH ROW EXECUTE FUNCTION erp_project_invoice_source_guard();
CREATE TRIGGER project_invoice_invoice_scope BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_project_invoice_source_guard();
ALTER TABLE "ProjectInvoiceLink" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ProjectInvoiceLink" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_project_invoice_guard(),erp_project_invoice_audit(),erp_project_invoice_source_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT;BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON "ProjectInvoiceLink" FROM %I',role_name);EXECUTE format('REVOKE ALL ON FUNCTION erp_project_invoice_guard(),erp_project_invoice_audit(),erp_project_invoice_source_guard() FROM %I',role_name);END IF;END LOOP;END $$;
INSERT INTO "Permission"(key) VALUES('project-billing:read'),('project-billing:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,key FROM "Role" CROSS JOIN(VALUES('project-billing:read'),('project-billing:manage')) AS p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
