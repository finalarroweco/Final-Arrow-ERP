-- Records completed same-company, same-item physical transfers, not transit or fulfilment.
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TABLE "StockBalance" ADD COLUMN "transferOpeningDelta" DECIMAL(30,3);
CREATE TABLE "StockTransfer" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "sourceBranchId" UUID NOT NULL, "destinationBranchId" UUID NOT NULL, "itemId" UUID NOT NULL,
 quantity DECIMAL(18,3) NOT NULL CHECK(quantity>0 AND quantity<=999999999.999),
 reference VARCHAR(120) NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 120),
 reason VARCHAR(300) NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 300),
 "correctsId" UUID UNIQUE REFERENCES "StockTransfer"(id) ON DELETE RESTRICT,
 "createdBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
 unit VARCHAR(16) NOT NULL DEFAULT '', "itemName" TEXT NOT NULL DEFAULT '', "itemSku" TEXT NOT NULL DEFAULT '',
 "companyName" TEXT NOT NULL DEFAULT '', "sourceBranchName" TEXT NOT NULL DEFAULT '', "destinationBranchName" TEXT NOT NULL DEFAULT '', "actorName" TEXT NOT NULL DEFAULT '',
 CHECK("sourceBranchId"<>"destinationBranchId"),
 FOREIGN KEY("tenantId","companyId","sourceBranchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","destinationBranchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","itemId") REFERENCES "InventoryItem"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "StockTransfer_tenantId_companyId_createdAt_id_idx" ON "StockTransfer"("tenantId","companyId","createdAt",id);
CREATE INDEX "StockTransfer_itemId_idx" ON "StockTransfer"("itemId");
ALTER TABLE "StockMovement" ADD COLUMN "transferId" UUID REFERENCES "StockTransfer"(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX "StockMovement_transferId_type_key" ON "StockMovement"("transferId",type);
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_delta_direction";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_direction" CHECK (
 (type::text IN ('ADJUSTMENT_IN','PURCHASE_RECEIPT','TRANSFER_IN') AND delta>0) OR
 (type::text IN ('ADJUSTMENT_OUT','PURCHASE_RETURN','TRANSFER_OUT') AND delta<0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_transfer_link" CHECK ((type::text IN ('TRANSFER_IN','TRANSFER_OUT'))=("transferId" IS NOT NULL));
INSERT INTO "Permission"(key) VALUES('inventory-transfer:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'inventory-transfer:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;

CREATE FUNCTION erp_transfer_permission(t UUID,c UUID,b UUID,u UUID,p TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Membership" m JOIN "RoleGrant" g ON g."tenantId"=m."tenantId" AND g."membershipId"=m.id JOIN "RolePermission" rp ON rp."tenantId"=g."tenantId" AND rp."roleId"=g."roleId" JOIN "AccessScope" s ON s."tenantId"=g."tenantId" AND s."grantId"=g.id WHERE m."tenantId"=t AND m."userId"=u AND m.status='ACTIVE' AND rp."permissionKey"=p AND (s.type='TENANT' OR (s."companyId"=c AND (s.type='COMPANY' OR (s.type='BRANCH' AND s."branchId"=b)))));
$$;
CREATE FUNCTION erp_prepare_stock_transfer() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE item RECORD; original RECORD; branch_id UUID; b RECORD; source RECORD; destination RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Transfer history is immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:'||NEW.id::text,0));
 IF EXISTS(SELECT 1 FROM "StockTransferCancellation" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Transfer request permanently cancelled' USING ERRCODE='23514'; END IF;
 FOREACH branch_id IN ARRAY ARRAY[NEW."sourceBranchId",NEW."destinationBranchId"] LOOP
  IF NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",branch_id,NEW."createdBy",'inventory-stock:read') OR NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",branch_id,NEW."createdBy",'inventory-stock:adjust') OR NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",branch_id,NEW."createdBy",'inventory-transfer:manage') THEN RAISE EXCEPTION 'Both branch permissions required' USING ERRCODE='23514'; END IF;
 END LOOP;
 SELECT * INTO item FROM "InventoryItem" WHERE id=NEW."itemId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR SHARE;
 IF item.id IS NULL OR item."branchId" IS NOT NULL OR item."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'Active company-wide item required' USING ERRCODE='23514'; END IF;
 IF NEW.unit<>'' AND NEW.unit<>item.unit THEN RAISE EXCEPTION 'Stock unit changed; record a new request in the current unit' USING ERRCODE='23514'; END IF;
 IF NEW."sourceBranchId"=NEW."destinationBranchId" OR NEW.quantity<=0 OR NEW.quantity>999999999.999 THEN RAISE EXCEPTION 'Invalid transfer branches or quantity' USING ERRCODE='23514'; END IF;
 IF NEW."correctsId" IS NOT NULL THEN
  SELECT * INTO original FROM "StockTransfer" WHERE id=NEW."correctsId";
  IF original.id IS NULL OR original."correctsId" IS NOT NULL OR original."tenantId"<>NEW."tenantId" OR original."companyId"<>NEW."companyId" OR original."itemId"<>NEW."itemId" OR original."sourceBranchId"<>NEW."destinationBranchId" OR original."destinationBranchId"<>NEW."sourceBranchId" OR original.quantity<>NEW.quantity OR original.reference<>NEW.reference OR original.unit<>item.unit THEN RAISE EXCEPTION 'Correction must reverse the full original transfer in the original unit' USING ERRCODE='23514'; END IF;
 END IF;
 -- Missing balances are created in branch order. Existing balances are locked by UUID,
 -- matching supplier returns. Receipt item UPDATE locks serialize their multi-item work.
 FOR branch_id IN SELECT unnest(ARRAY[NEW."sourceBranchId",NEW."destinationBranchId"]) ORDER BY 1 LOOP
  INSERT INTO "StockBalance"(id,"tenantId","companyId","branchId","itemId",quantity,"reservedQuantity","updatedAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."companyId",branch_id,NEW."itemId",0,0,clock_timestamp()) ON CONFLICT("tenantId","companyId","branchId","itemId") DO NOTHING;
 END LOOP;
 FOR b IN SELECT * FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "itemId"=NEW."itemId" AND "branchId" IN (NEW."sourceBranchId",NEW."destinationBranchId") ORDER BY id FOR UPDATE LOOP
  IF b."transferOpeningDelta" IS NULL THEN UPDATE "StockBalance" SET "transferOpeningDelta"=b.quantity-(SELECT coalesce(sum(delta),0) FROM "StockMovement" WHERE "balanceId"=b.id) WHERE id=b.id; END IF;
 END LOOP;
 SELECT * INTO source FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."sourceBranchId" AND "itemId"=NEW."itemId";
 SELECT * INTO destination FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."destinationBranchId" AND "itemId"=NEW."itemId";
 IF source.quantity-source."reservedQuantity"<NEW.quantity OR destination.quantity>999999999999999.999-NEW.quantity THEN RAISE EXCEPTION 'Insufficient available stock or destination overflow' USING ERRCODE='23514'; END IF;
 NEW.unit:=item.unit; NEW."itemName":=item.name; NEW."itemSku":=item.sku;
 SELECT name INTO NEW."companyName" FROM "Company" WHERE id=NEW."companyId";
 SELECT name INTO NEW."sourceBranchName" FROM "Branch" WHERE id=NEW."sourceBranchId";
 SELECT name INTO NEW."destinationBranchName" FROM "Branch" WHERE id=NEW."destinationBranchId";
 SELECT name INTO NEW."actorName" FROM "User" WHERE id=NEW."createdBy";
 NEW."createdAt":=clock_timestamp(); NEW."transactionId":=txid_current()::text;
 RETURN NEW;
END $$;
CREATE TRIGGER prepare_stock_transfer BEFORE INSERT OR UPDATE OR DELETE ON "StockTransfer" FOR EACH ROW EXECUTE FUNCTION erp_prepare_stock_transfer();
CREATE FUNCTION erp_apply_stock_transfer() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_id UUID; destination_id UUID;
BEGIN
 SELECT id INTO source_id FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."sourceBranchId" AND "itemId"=NEW."itemId";
 SELECT id INTO destination_id FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."destinationBranchId" AND "itemId"=NEW."itemId";
 UPDATE "StockBalance" SET quantity=quantity-NEW.quantity,"updatedAt"=NEW."createdAt" WHERE id=source_id;
 UPDATE "StockBalance" SET quantity=quantity+NEW.quantity,"updatedAt"=NEW."createdAt" WHERE id=destination_id;
 INSERT INTO "StockMovement"(id,"tenantId","balanceId",type,delta,reason,"actorId","createdAt","transferId") VALUES
 (gen_random_uuid(),NEW."tenantId",source_id,'TRANSFER_OUT',-NEW.quantity,'Branch stock transfer',NEW."createdBy",NEW."createdAt",NEW.id),
 (gen_random_uuid(),NEW."tenantId",destination_id,'TRANSFER_IN',NEW.quantity,'Branch stock transfer',NEW."createdBy",NEW."createdAt",NEW.id);
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'inventory-transfer.recorded','StockTransfer',NEW.id::text,jsonb_build_object('transactionId',NEW."transactionId",'sourceBranchId',NEW."sourceBranchId",'destinationBranchId',NEW."destinationBranchId",'itemId',NEW."itemId",'quantity',NEW.quantity::text,'unit',NEW.unit,'reference',NEW.reference,'reason',NEW.reason,'correctsId',NEW."correctsId"),NEW."createdAt");
 RETURN NULL;
END $$;
CREATE TRIGGER apply_stock_transfer AFTER INSERT ON "StockTransfer" FOR EACH ROW EXECUTE FUNCTION erp_apply_stock_transfer();
CREATE FUNCTION erp_guard_transfer_movement() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE t RECORD; b RECORD;
BEGIN
 IF TG_OP<>'INSERT' THEN
  -- Serialize history edits with the first transfer before deciding whether history is frozen.
  IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM "StockBalance" WHERE id IN (OLD."balanceId",NEW."balanceId") ORDER BY id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM "StockBalance" WHERE id=NEW."balanceId" AND "transferOpeningDelta" IS NOT NULL) THEN RAISE EXCEPTION 'Transfer stock history is immutable' USING ERRCODE='23514'; END IF;
  ELSE PERFORM 1 FROM "StockBalance" WHERE id=OLD."balanceId" FOR UPDATE; END IF;
  IF OLD."transferId" IS NOT NULL OR EXISTS(SELECT 1 FROM "StockBalance" WHERE id=OLD."balanceId" AND "transferOpeningDelta" IS NOT NULL) THEN RAISE EXCEPTION 'Transfer stock history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 END IF;
 PERFORM 1 FROM "StockBalance" WHERE id=NEW."balanceId" FOR UPDATE;
 IF NEW."transferId" IS NOT NULL THEN
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Transfer legs are created only with their paired document' USING ERRCODE='23514'; END IF;
  SELECT * INTO t FROM "StockTransfer" WHERE id=NEW."transferId";
  SELECT * INTO b FROM "StockBalance" WHERE id=NEW."balanceId";
  IF t.id IS NULL OR t."transactionId"<>txid_current()::text OR NEW."tenantId"<>t."tenantId" OR b."tenantId"<>t."tenantId" OR b."companyId"<>t."companyId" OR b."itemId"<>t."itemId" OR NEW."actorId"<>t."createdBy" OR NEW."createdAt"<>t."createdAt" OR NEW.reason<>'Branch stock transfer' OR NOT ((NEW.type::text='TRANSFER_OUT' AND b."branchId"=t."sourceBranchId" AND NEW.delta=-t.quantity) OR (NEW.type::text='TRANSFER_IN' AND b."branchId"=t."destinationBranchId" AND NEW.delta=t.quantity)) THEN RAISE EXCEPTION 'Invalid transfer leg' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_transfer_movement BEFORE INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION erp_guard_transfer_movement();
CREATE FUNCTION erp_guard_transfer_balance() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."transferOpeningDelta" IS NOT NULL THEN RAISE EXCEPTION 'Opening projection requires a transfer' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 IF NEW."transferOpeningDelta" IS DISTINCT FROM OLD."transferOpeningDelta" AND NOT(OLD."transferOpeningDelta" IS NULL AND NEW."transferOpeningDelta" IS NOT NULL AND pg_trigger_depth()>1) THEN RAISE EXCEPTION 'Transfer stock opening projection is immutable' USING ERRCODE='23514'; END IF;
 IF OLD."transferOpeningDelta" IS NOT NULL AND (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."itemId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."itemId") THEN RAISE EXCEPTION 'Transfer balance scope is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_transfer_balance BEFORE INSERT OR UPDATE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION erp_guard_transfer_balance();
CREATE FUNCTION erp_check_transfer_projection() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE balance_id UUID; balance_ids UUID[]; b RECORD;
BEGIN
 IF TG_TABLE_NAME='StockBalance' THEN balance_ids:=ARRAY[NEW.id];
 ELSIF TG_OP='DELETE' THEN balance_ids:=ARRAY[OLD."balanceId"];
 ELSIF TG_OP='UPDATE' THEN balance_ids:=ARRAY[OLD."balanceId",NEW."balanceId"];
 ELSE balance_ids:=ARRAY[NEW."balanceId"]; END IF;
 FOREACH balance_id IN ARRAY balance_ids LOOP
  SELECT * INTO b FROM "StockBalance" WHERE id=balance_id;
  IF b."transferOpeningDelta" IS NOT NULL AND b.quantity<>b."transferOpeningDelta"+(SELECT coalesce(sum(delta),0) FROM "StockMovement" WHERE "balanceId"=balance_id) THEN RAISE EXCEPTION 'Transfer stock projection must equal immutable movement history' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_transfer_balance AFTER INSERT OR UPDATE ON "StockBalance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_transfer_projection();
CREATE CONSTRAINT TRIGGER check_transfer_movement_projection AFTER INSERT OR UPDATE OR DELETE ON "StockMovement" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_transfer_projection();
CREATE FUNCTION erp_check_stock_transfer() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM "StockMovement" WHERE "transferId"=NEW.id)<>2 OR NOT EXISTS(SELECT 1 FROM "StockMovement" WHERE "transferId"=NEW.id AND type::text='TRANSFER_IN') OR NOT EXISTS(SELECT 1 FROM "StockMovement" WHERE "transferId"=NEW.id AND type::text='TRANSFER_OUT') OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='StockTransfer' AND "entityId"=NEW.id::text AND action='inventory-transfer.recorded' AND metadata->>'transactionId'=NEW."transactionId") THEN RAISE EXCEPTION 'Transfer requires exact pair and audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_stock_transfer AFTER INSERT ON "StockTransfer" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_stock_transfer();
CREATE FUNCTION erp_guard_transfer_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.entity IN ('StockTransfer','StockTransferCancellation') THEN RAISE EXCEPTION 'Transfer audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity='StockMovement' AND NEW.action IN ('inventory-stock.reversed','inventory-stock.reversal-created') AND EXISTS(SELECT 1 FROM "StockMovement" WHERE "transferId" IS NOT NULL AND (id::text=NEW."entityId" OR id::text=NEW.metadata->>'originalId')) THEN RAISE EXCEPTION 'Transfer legs require a paired transfer correction' USING ERRCODE='23514'; END IF;
 IF NEW.entity IN ('StockTransfer','StockTransferCancellation') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Transfer audit is generated by its document' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_transfer_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_transfer_audit();
CREATE FUNCTION erp_guard_transfer_item_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "StockTransfer" WHERE "itemId"=OLD.id) THEN RAISE EXCEPTION 'Transferred item scope is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_transfer_item_scope BEFORE UPDATE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION erp_guard_transfer_item_scope();
ALTER TABLE "StockTransfer" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StockTransfer" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_transfer_permission(UUID,UUID,UUID,UUID,TEXT),erp_prepare_stock_transfer(),erp_apply_stock_transfer(),erp_guard_transfer_movement(),erp_guard_transfer_balance(),erp_check_transfer_projection(),erp_check_stock_transfer(),erp_guard_transfer_audit(),erp_guard_transfer_item_scope() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "StockTransfer" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_transfer_permission(UUID,UUID,UUID,UUID,TEXT),erp_prepare_stock_transfer(),erp_apply_stock_transfer(),erp_guard_transfer_movement(),erp_guard_transfer_balance(),erp_check_transfer_projection(),erp_check_stock_transfer(),erp_guard_transfer_audit(),erp_guard_transfer_item_scope() FROM %I',r);
 END IF; END LOOP; END $$;
-- An explicit cancellation tombstones a request UUID before the browser may forget it.
CREATE TABLE "StockTransferCancellation" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "createdBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 request JSONB NOT NULL,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "StockTransferCancellation_tenantId_companyId_createdAt_idx" ON "StockTransferCancellation"("tenantId","companyId","createdAt");
CREATE FUNCTION erp_guard_transfer_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE src UUID; dst UUID; b UUID;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Request cancellation is permanent' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-transfer:'||NEW.id::text,0));
 IF NEW.request->>'expectedActorId' IS DISTINCT FROM NEW."createdBy"::text THEN RAISE EXCEPTION 'Cancellation actor mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.request->>'requestId' IS DISTINCT FROM NEW.id::text OR NEW.request->>'tenantId' IS DISTINCT FROM NEW."tenantId"::text OR NEW.request->>'companyId' IS DISTINCT FROM NEW."companyId"::text OR EXISTS(SELECT 1 FROM "StockTransfer" WHERE id=NEW.id) THEN RAISE EXCEPTION 'Cannot cancel a recorded transfer or mismatched request' USING ERRCODE='23514'; END IF;
 IF NEW.request->>'action'='transfer' THEN src:=(NEW.request->>'sourceBranchId')::uuid; dst:=(NEW.request->>'destinationBranchId')::uuid;
 ELSIF NEW.request->>'action'='correct' THEN SELECT "sourceBranchId","destinationBranchId" INTO src,dst FROM "StockTransfer" WHERE id=(NEW.request->>'transferId')::uuid AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId";
 ELSE RAISE EXCEPTION 'Invalid cancelled action' USING ERRCODE='23514'; END IF;
 IF src IS NULL OR dst IS NULL OR src=dst THEN RAISE EXCEPTION 'Cancellation branches required' USING ERRCODE='23514'; END IF;
 FOREACH b IN ARRAY ARRAY[src,dst] LOOP
 IF NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",b,NEW."createdBy",'inventory-stock:read') OR NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",b,NEW."createdBy",'inventory-stock:adjust') OR NOT erp_transfer_permission(NEW."tenantId",NEW."companyId",b,NEW."createdBy",'inventory-transfer:manage') THEN RAISE EXCEPTION 'Both branch permissions required for cancellation' USING ERRCODE='23514'; END IF;
 END LOOP;
 NEW."createdAt":=clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER guard_transfer_cancellation BEFORE INSERT OR UPDATE OR DELETE ON "StockTransferCancellation" FOR EACH ROW EXECUTE FUNCTION erp_guard_transfer_cancellation();
CREATE FUNCTION erp_audit_transfer_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'inventory-transfer.request-cancelled','StockTransferCancellation',NEW.id::text,jsonb_build_object('request',NEW.request,'transactionId',txid_current()::text),NEW."createdAt"); RETURN NULL;
END $$;
CREATE TRIGGER audit_transfer_cancellation AFTER INSERT ON "StockTransferCancellation" FOR EACH ROW EXECUTE FUNCTION erp_audit_transfer_cancellation();
ALTER TABLE "StockTransferCancellation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StockTransferCancellation" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_guard_transfer_cancellation(),erp_audit_transfer_cancellation() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "StockTransferCancellation" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_guard_transfer_cancellation(),erp_audit_transfer_cancellation() FROM %I',r);
 END IF; END LOOP; END $$;
