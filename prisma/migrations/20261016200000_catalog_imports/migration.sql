CREATE TABLE "CatalogImportBatch" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID,kind VARCHAR(10) NOT NULL CHECK(kind IN('CUSTOMER','SUPPLIER','ITEM')),digest VARCHAR(64) NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),"rowCount" INTEGER NOT NULL CHECK("rowCount" BETWEEN 1 AND 500),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"transactionId" TEXT NOT NULL DEFAULT (txid_current())::text,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE INDEX "CatalogImportBatch_scope_created_idx" ON "CatalogImportBatch"("tenantId","companyId","branchId",kind,"createdAt",id);
ALTER TABLE "Customer" ADD COLUMN "importBatchId" UUID REFERENCES "CatalogImportBatch"(id) ON DELETE RESTRICT;
ALTER TABLE "Supplier" ADD COLUMN "importBatchId" UUID REFERENCES "CatalogImportBatch"(id) ON DELETE RESTRICT;
ALTER TABLE "InventoryItem" ADD COLUMN "importBatchId" UUID REFERENCES "CatalogImportBatch"(id) ON DELETE RESTRICT;
CREATE INDEX "Customer_importBatchId_idx" ON "Customer"("importBatchId");CREATE INDEX "Supplier_importBatchId_idx" ON "Supplier"("importBatchId");CREATE INDEX "InventoryItem_importBatchId_idx" ON "InventoryItem"("importBatchId");
CREATE FUNCTION erp_catalog_import_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."createdBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Import requires an active scoped actor' USING ERRCODE='23514';END IF;
 NEW."transactionId":=txid_current()::text;NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER catalog_import_guard BEFORE INSERT ON "CatalogImportBatch" FOR EACH ROW EXECUTE FUNCTION erp_catalog_import_guard();
CREATE TRIGGER catalog_import_immutable BEFORE UPDATE OR DELETE ON "CatalogImportBatch" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_catalog_import_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE batch "CatalogImportBatch"%ROWTYPE;expected_kind TEXT;
BEGIN
 IF TG_OP='DELETE' THEN IF OLD."importBatchId" IS NOT NULL THEN RAISE EXCEPTION 'Imported history must be archived, not deleted' USING ERRCODE='23514';END IF;RETURN OLD;END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW."importBatchId" IS DISTINCT FROM OLD."importBatchId" OR (OLD."importBatchId" IS NOT NULL AND ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."createdBy",OLD."createdAt")) THEN RAISE EXCEPTION 'Import provenance is immutable' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW."importBatchId" IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO batch FROM "CatalogImportBatch" WHERE id=NEW."importBatchId";
 expected_kind:=CASE TG_TABLE_NAME WHEN 'Customer' THEN 'CUSTOMER' WHEN 'Supplier' THEN 'SUPPLIER' ELSE 'ITEM' END;
 IF batch.id IS NULL OR batch.kind<>expected_kind OR batch."transactionId"<>txid_current()::text OR ROW(NEW."tenantId",NEW."companyId",NEW."branchId",NEW."createdBy") IS DISTINCT FROM ROW(batch."tenantId",batch."companyId",batch."branchId",batch."createdBy") THEN RAISE EXCEPTION 'Import row must match its current transaction and source scope' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER catalog_customer_provenance BEFORE INSERT OR UPDATE OR DELETE ON "Customer" FOR EACH ROW EXECUTE FUNCTION erp_catalog_import_source_guard();
CREATE TRIGGER catalog_supplier_provenance BEFORE INSERT OR UPDATE OR DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION erp_catalog_import_source_guard();
CREATE TRIGGER catalog_item_provenance BEFORE INSERT OR UPDATE OR DELETE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION erp_catalog_import_source_guard();
CREATE FUNCTION erp_catalog_import_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_count INTEGER;audited_count INTEGER;entity_name TEXT;action_name TEXT;
BEGIN
 entity_name:=CASE NEW.kind WHEN 'CUSTOMER' THEN 'Customer' WHEN 'SUPPLIER' THEN 'Supplier' ELSE 'InventoryItem' END;action_name:=CASE NEW.kind WHEN 'CUSTOMER' THEN 'customer.created' WHEN 'SUPPLIER' THEN 'supplier.created' ELSE 'inventory-item.created' END;
 SELECT count(*) INTO source_count FROM(SELECT id FROM "Customer" WHERE "importBatchId"=NEW.id UNION ALL SELECT id FROM "Supplier" WHERE "importBatchId"=NEW.id UNION ALL SELECT id FROM "InventoryItem" WHERE "importBatchId"=NEW.id) records;
 SELECT count(DISTINCT a."entityId") INTO audited_count FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity=entity_name AND a.action=action_name AND a.metadata->>'importBatchId'=NEW.id::text AND a.metadata->>'transaction'=txid_current()::text AND a."entityId" IN(SELECT id::text FROM "Customer" WHERE "importBatchId"=NEW.id UNION ALL SELECT id::text FROM "Supplier" WHERE "importBatchId"=NEW.id UNION ALL SELECT id::text FROM "InventoryItem" WHERE "importBatchId"=NEW.id);
 IF source_count<>NEW."rowCount" OR audited_count<>source_count OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='CatalogImportBatch' AND "entityId"=NEW.id::text AND action='catalog-import.committed' AND metadata->>'digest'=NEW.digest AND metadata->>'kind'=NEW.kind AND metadata->>'rowCount'=NEW."rowCount"::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Import requires exact source rows and current transaction audits' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER catalog_import_audit AFTER INSERT ON "CatalogImportBatch" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_catalog_import_audit();
ALTER TABLE "CatalogImportBatch" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CatalogImportBatch" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CatalogImportBatch" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_catalog_import_guard(),erp_catalog_import_source_guard(),erp_catalog_import_audit() FROM PUBLIC;
