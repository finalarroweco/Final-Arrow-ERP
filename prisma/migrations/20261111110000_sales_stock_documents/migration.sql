BEGIN;
-- Publish all guards, source links and final browser revocations atomically.
-- New enum labels are compared only through type::text constraints here;
-- procedural functions consume them only at runtime after this migration commits.
-- Do not insert or otherwise use new enum values before COMMIT.
-- Explicit physical stock records only: no commercial demand, accounting or lifecycle effects.
ALTER TYPE "StockMovementType" ADD VALUE 'SALES_DELIVERY';
ALTER TYPE "StockMovementType" ADD VALUE 'SALES_RETURN';
ALTER TYPE "StockMovementType" ADD VALUE 'SALES_CORRECTION_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'SALES_CORRECTION_OUT';
CREATE TABLE "SalesStockDocument" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"orderId" UUID NOT NULL,"lineId" UUID,
 "branchId" UUID NOT NULL,"itemId" UUID NOT NULL,"balanceId" UUID NOT NULL DEFAULT gen_random_uuid(),
 kind VARCHAR(16) NOT NULL CHECK(kind IN ('DELIVERY','RETURN','CORRECTION')),
 "deliveryId" UUID,"correctsId" UUID UNIQUE,"holdId" UUID UNIQUE,"releaseRequestId" UUID UNIQUE,
 quantity DECIMAL(18,3) NOT NULL CHECK(quantity>0 AND quantity<=999999999.999),delta DECIMAL(18,3) NOT NULL DEFAULT 0,
 unit VARCHAR(16) NOT NULL CHECK(length(unit)>0),reference VARCHAR(120) NOT NULL CHECK(length(btrim(reference)) BETWEEN 3 AND 120),
 reason VARCHAR(300) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 300),"physicalConfirmed" BOOLEAN NOT NULL CHECK("physicalConfirmed"),
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"transactionId" TEXT NOT NULL DEFAULT txid_current()::text,
 "orderNumber" TEXT NOT NULL DEFAULT '',"customerName" TEXT NOT NULL DEFAULT '',"linePosition" INTEGER,"lineDescription" TEXT,
 "itemName" TEXT NOT NULL DEFAULT '',"itemSku" TEXT NOT NULL DEFAULT '',"branchName" TEXT NOT NULL DEFAULT '',"companyName" TEXT NOT NULL DEFAULT '',"actorName" TEXT NOT NULL DEFAULT '',
 UNIQUE("tenantId","companyId","orderId","branchId","itemId",id),
 CHECK((kind='DELIVERY' AND "deliveryId" IS NULL AND "correctsId" IS NULL AND (("holdId" IS NULL AND "releaseRequestId" IS NULL) OR ("holdId" IS NOT NULL AND "releaseRequestId"=id))) OR (kind='RETURN' AND "deliveryId" IS NOT NULL AND "correctsId" IS NULL AND "holdId" IS NULL AND "releaseRequestId" IS NULL) OR (kind='CORRECTION' AND "deliveryId" IS NULL AND "correctsId" IS NOT NULL AND "holdId" IS NULL AND "releaseRequestId" IS NULL)),
 FOREIGN KEY("tenantId","companyId","orderId") REFERENCES "SalesOrder"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","orderId","lineId") REFERENCES "SalesOrderLine"("tenantId","orderId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId","itemId","balanceId") REFERENCES "StockBalance"("tenantId","companyId","branchId","itemId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","orderId","branchId","itemId","deliveryId") REFERENCES "SalesStockDocument"("tenantId","companyId","orderId","branchId","itemId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","orderId","branchId","itemId","correctsId") REFERENCES "SalesStockDocument"("tenantId","companyId","orderId","branchId","itemId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","balanceId","holdId") REFERENCES "OrderStockReservation"("tenantId","balanceId","reservationId") ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SalesStockDocument_tenantId_companyId_orderId_createdAt_id_idx" ON "SalesStockDocument"("tenantId","companyId","orderId","createdAt",id);
CREATE INDEX "SalesStockDocument_deliveryId_idx" ON "SalesStockDocument"("deliveryId");
CREATE INDEX "SalesStockDocument_itemId_idx" ON "SalesStockDocument"("itemId");
CREATE TABLE "SalesStockCancellation" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,request JSONB NOT NULL,
 FOREIGN KEY("tenantId","companyId") REFERENCES "Company"("tenantId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","createdBy") REFERENCES "Membership"("tenantId","userId") ON DELETE RESTRICT
);
CREATE INDEX "SalesStockCancellation_tenantId_companyId_createdAt_idx" ON "SalesStockCancellation"("tenantId","companyId","createdAt");
ALTER TABLE "StockMovement" ADD COLUMN "salesDocumentId" UUID UNIQUE REFERENCES "SalesStockDocument"(id) ON DELETE RESTRICT;
ALTER TABLE "StockReservation" ADD COLUMN "salesDeliveryId" UUID UNIQUE REFERENCES "SalesStockDocument"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_delta_direction";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_delta_direction" CHECK (
 (type::text IN ('ADJUSTMENT_IN','PURCHASE_RECEIPT','TRANSFER_IN','SALES_RETURN','SALES_CORRECTION_IN') AND delta>0) OR
 (type::text IN ('ADJUSTMENT_OUT','PURCHASE_RETURN','TRANSFER_OUT','SALES_DELIVERY','SALES_CORRECTION_OUT') AND delta<0));
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sales_document_link" CHECK ((type::text IN ('SALES_DELIVERY','SALES_RETURN','SALES_CORRECTION_IN','SALES_CORRECTION_OUT'))=("salesDocumentId" IS NOT NULL));
INSERT INTO "Permission"(key) VALUES('order-delivery:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'order-delivery:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;

CREATE FUNCTION erp_sales_stock_rights(t UUID,c UUID,o UUID,b UUID,u UUID,hold BOOLEAN DEFAULT false) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "SalesOrder" s WHERE s.id=o AND s."tenantId"=t AND s."companyId"=c AND (s."branchId" IS NULL OR s."branchId"=b)
 AND erp_payment_term_actor_access(u,t,c,s."branchId",'order:read') AND erp_payment_term_actor_access(u,t,c,s."branchId",'order-delivery:manage')
 AND erp_payment_term_actor_access(u,t,c,b,'inventory-stock:read') AND erp_payment_term_actor_access(u,t,c,b,'inventory-stock:adjust')
 AND (NOT hold OR erp_payment_term_actor_access(u,t,c,s."branchId",'order-reservation:manage')));
$$;
CREATE FUNCTION erp_prepare_sales_stock() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE item RECORD; b RECORD; o RECORD; original RECORD; l RECORD; h RECORD; r RECORD; returned NUMERIC;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Sales stock history is immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Sales stock recording requires READ COMMITTED for current authorization' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-stock:'||NEW.id::text,0));
 -- Always take this namespace too, before any item/balance lock. Ordinary hold requests
 -- only take this mutex and never wait for the sales mutex, avoiding an inverted edge.
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-reservation-request:'||NEW.id::text,0));
 IF EXISTS(SELECT 1 FROM "SalesStockCancellation" WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM "StockReservation" WHERE id=NEW.id OR "releaseRequestId"=NEW.id) THEN RAISE EXCEPTION 'Request UUID already used or cancelled' USING ERRCODE='23514'; END IF;
 SELECT * INTO item FROM "InventoryItem" WHERE id=NEW."itemId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR SHARE;
 IF item.id IS NULL OR (item."branchId" IS NOT NULL AND item."branchId"<>NEW."branchId") OR NEW.unit IS DISTINCT FROM item.unit OR (NEW.kind='DELIVERY' AND item."archivedAt" IS NOT NULL) THEN RAISE EXCEPTION 'Item scope, state or original unit unavailable' USING ERRCODE='23514'; END IF;
 INSERT INTO "StockBalance"(id,"tenantId","companyId","branchId","itemId",quantity,"reservedQuantity","updatedAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."companyId",NEW."branchId",NEW."itemId",0,0,clock_timestamp()) ON CONFLICT("tenantId","companyId","branchId","itemId") DO NOTHING;
 SELECT * INTO b FROM "StockBalance" WHERE "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "branchId"=NEW."branchId" AND "itemId"=NEW."itemId" FOR UPDATE;
 NEW."balanceId":=b.id;
 SELECT * INTO o FROM "SalesOrder" WHERE id=NEW."orderId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF o.id IS NULL OR NOT erp_sales_stock_rights(NEW."tenantId",NEW."companyId",NEW."orderId",NEW."branchId",NEW."createdBy",NEW."holdId" IS NOT NULL) THEN RAISE EXCEPTION 'Current source and stock permissions required' USING ERRCODE='23514'; END IF;
 IF NEW.kind='DELIVERY' THEN
  IF o.status NOT IN ('NEW','IN_PROGRESS','COMPLETED') THEN RAISE EXCEPTION 'Cancelled orders cannot receive new deliveries' USING ERRCODE='23514'; END IF;
  NEW.delta:=-NEW.quantity;
  IF NEW."holdId" IS NOT NULL THEN
   SELECT * INTO h FROM "OrderStockReservation" WHERE "reservationId"=NEW."holdId" FOR UPDATE;
   SELECT * INTO r FROM "StockReservation" WHERE id=NEW."holdId" FOR UPDATE;
   IF h."reservationId" IS NULL OR r.id IS NULL OR r."releasedAt" IS NOT NULL OR r."sourceKind"<>'ORDER_MANUAL' OR (h."tenantId",h."companyId",h."orderId",h."branchId",h."itemId",h."balanceId",h."lineId",h."itemUnit") IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."orderId",NEW."branchId",NEW."itemId",b.id,NEW."lineId",NEW.unit) OR r.quantity<>NEW.quantity THEN RAISE EXCEPTION 'Delivery requires exactly the selected active full order hold' USING ERRCODE='23514'; END IF;
   NEW."releaseRequestId":=NEW.id;
   UPDATE "StockReservation" SET "releaseRequestId"=NEW.id,"releasedBy"=NEW."createdBy","releaseReason"='Released for physical delivery',"salesDeliveryId"=NEW.id WHERE id=r.id;
   SELECT * INTO r FROM "StockReservation" WHERE id=r.id;
   INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES
    (gen_random_uuid(),NEW."tenantId",NEW."createdBy",'inventory-stock.reservation-released','StockReservation',r.id::text,jsonb_build_object('balanceId',b.id,'transactionId',r."releaseTransaction",'requestId',NEW.id,'reason','Released for physical delivery'),r."releasedAt"),
    (gen_random_uuid(),NEW."tenantId",NEW."createdBy",'order-stock.released','OrderStockReservation',r.id::text,jsonb_build_object('orderId',o.id,'transactionId',r."releaseTransaction",'requestId',NEW.id,'reason',NEW.reason,'salesDeliveryId',NEW.id),r."releasedAt");
   SELECT * INTO b FROM "StockBalance" WHERE id=b.id;
  END IF;
 ELSIF NEW.kind IN ('RETURN','CORRECTION') THEN
  SELECT * INTO original FROM "SalesStockDocument" WHERE id=coalesce(NEW."deliveryId",NEW."correctsId") FOR UPDATE;
  IF original.id IS NULL OR (original."tenantId",original."companyId",original."orderId",original."branchId",original."itemId",original."lineId",original.unit) IS DISTINCT FROM (NEW."tenantId",NEW."companyId",NEW."orderId",NEW."branchId",NEW."itemId",NEW."lineId",NEW.unit) THEN RAISE EXCEPTION 'Original source and unit must match exactly' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE "correctsId"=original.id) THEN RAISE EXCEPTION 'Original document is corrected' USING ERRCODE='23514'; END IF;
  IF NEW.kind='RETURN' THEN
   IF original.kind<>'DELIVERY' THEN RAISE EXCEPTION 'Return requires an original delivery' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum(d.quantity),0) INTO returned FROM "SalesStockDocument" d WHERE d."deliveryId"=original.id AND d.kind='RETURN' AND NOT EXISTS(SELECT 1 FROM "SalesStockDocument" x WHERE x."correctsId"=d.id);
   IF returned+NEW.quantity>original.quantity THEN RAISE EXCEPTION 'Return exceeds net remaining delivered quantity' USING ERRCODE='23514'; END IF;
   NEW.delta:=NEW.quantity;
  ELSE
   IF original.kind='CORRECTION' OR NEW.quantity<>original.quantity OR NEW.reference<>original.reference THEN RAISE EXCEPTION 'Correction must reverse one complete original document' USING ERRCODE='23514'; END IF;
   IF original.kind='DELIVERY' AND EXISTS(SELECT 1 FROM "SalesStockDocument" d WHERE d."deliveryId"=original.id AND d.kind='RETURN' AND NOT EXISTS(SELECT 1 FROM "SalesStockDocument" x WHERE x."correctsId"=d.id)) THEN RAISE EXCEPTION 'Correct dependent returns before correcting delivery' USING ERRCODE='23514'; END IF;
   NEW.delta:=-original.delta;
  END IF;
 ELSE RAISE EXCEPTION 'Unknown physical stock action' USING ERRCODE='23514'; END IF;
 IF NEW.quantity<=0 OR NEW.quantity>999999999.999 OR NEW."physicalConfirmed" IS DISTINCT FROM true OR b.quantity+NEW.delta<b."reservedQuantity" OR b.quantity+NEW.delta>999999999999999.999 THEN RAISE EXCEPTION 'Invalid quantity, missing physical confirmation, stock shortage or overflow' USING ERRCODE='23514'; END IF;
 -- Existing transfer projection is a general immutable movement projection: initialize
 -- its undated legacy offset, never invent dated legacy stock movements.
 IF b."transferOpeningDelta" IS NULL THEN UPDATE "StockBalance" SET "transferOpeningDelta"=b.quantity-(SELECT coalesce(sum(delta),0) FROM "StockMovement" WHERE "balanceId"=b.id) WHERE id=b.id; END IF;
 NEW."orderNumber":=o.number;NEW."customerName":=o."customerName";NEW."itemName":=item.name;NEW."itemSku":=item.sku;
 SELECT name INTO NEW."branchName" FROM "Branch" WHERE id=NEW."branchId";
 SELECT name INTO NEW."companyName" FROM "Company" WHERE id=NEW."companyId";
 SELECT name INTO NEW."actorName" FROM "User" WHERE id=NEW."createdBy";
 IF NEW."lineId" IS NOT NULL THEN
  SELECT * INTO l FROM "SalesOrderLine" WHERE id=NEW."lineId" AND "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" FOR SHARE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Source line belongs to another order' USING ERRCODE='23514'; END IF;
  NEW."linePosition":=l.position;NEW."lineDescription":=l.description;
 ELSE NEW."linePosition":=NULL;NEW."lineDescription":=NULL;END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;
 RETURN NEW;
END $$;
CREATE TRIGGER prepare_sales_stock BEFORE INSERT OR UPDATE OR DELETE ON "SalesStockDocument" FOR EACH ROW EXECUTE FUNCTION erp_prepare_sales_stock();
CREATE FUNCTION erp_apply_sales_stock() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE movement_type "StockMovementType";
BEGIN
 movement_type:=CASE WHEN NEW.kind='DELIVERY' THEN 'SALES_DELIVERY' WHEN NEW.kind='RETURN' THEN 'SALES_RETURN' WHEN NEW.delta>0 THEN 'SALES_CORRECTION_IN' ELSE 'SALES_CORRECTION_OUT' END;
 UPDATE "StockBalance" SET quantity=quantity+NEW.delta,"updatedAt"=NEW."createdAt" WHERE id=NEW."balanceId";
 INSERT INTO "StockMovement"(id,"tenantId","balanceId",type,delta,reason,"actorId","createdAt","salesDocumentId") VALUES(gen_random_uuid(),NEW."tenantId",NEW."balanceId",movement_type,NEW.delta,'Sales physical stock document',NEW."createdBy",NEW."createdAt",NEW.id);
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'sales-stock.recorded','SalesStockDocument',NEW.id::text,jsonb_build_object('transactionId',NEW."transactionId",'orderId',NEW."orderId",'branchId',NEW."branchId",'itemId',NEW."itemId",'kind',NEW.kind,'quantity',NEW.quantity::text,'unit',NEW.unit,'deliveryId',NEW."deliveryId",'correctsId',NEW."correctsId",'holdId',NEW."holdId",'reference',NEW.reference,'reason',NEW.reason),NEW."createdAt");
 RETURN NULL;
END $$;
CREATE TRIGGER apply_sales_stock AFTER INSERT ON "SalesStockDocument" FOR EACH ROW EXECUTE FUNCTION erp_apply_sales_stock();
CREATE FUNCTION erp_guard_sales_stock_movement() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE d RECORD;
BEGIN
 IF TG_OP<>'INSERT' AND OLD."salesDocumentId" IS NOT NULL THEN RAISE EXCEPTION 'Sales stock movement is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW."salesDocumentId" IS NOT NULL THEN
  SELECT * INTO d FROM "SalesStockDocument" WHERE id=NEW."salesDocumentId";
  IF TG_OP<>'INSERT' OR pg_trigger_depth()<2 OR d.id IS NULL OR d."transactionId"<>txid_current()::text OR (NEW."tenantId",NEW."balanceId",NEW.delta,NEW."actorId",NEW."createdAt",NEW.reason) IS DISTINCT FROM (d."tenantId",d."balanceId",d.delta,d."createdBy",d."createdAt",'Sales physical stock document'::text) OR NEW.type::text<>(CASE WHEN d.kind='DELIVERY' THEN 'SALES_DELIVERY' WHEN d.kind='RETURN' THEN 'SALES_RETURN' WHEN d.delta>0 THEN 'SALES_CORRECTION_IN' ELSE 'SALES_CORRECTION_OUT' END) THEN RAISE EXCEPTION 'Sales stock movement requires its exact same-transaction document' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_sales_stock_movement BEFORE INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_movement();
CREATE FUNCTION erp_check_sales_stock_document() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD;
BEGIN
 IF (SELECT count(*) FROM "StockMovement" WHERE "salesDocumentId"=NEW.id)<>1 OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='SalesStockDocument' AND "entityId"=NEW.id::text AND action='sales-stock.recorded' AND metadata->>'transactionId'=NEW."transactionId") THEN RAISE EXCEPTION 'Sales document requires exact movement and audit' USING ERRCODE='23514'; END IF;
 IF NEW."holdId" IS NOT NULL THEN
  SELECT * INTO r FROM "StockReservation" WHERE id=NEW."holdId";
  IF r.id IS NULL OR r."salesDeliveryId" IS DISTINCT FROM NEW.id OR r."releaseRequestId" IS DISTINCT FROM NEW.id OR r."releasedBy" IS DISTINCT FROM NEW."createdBy" OR r."releaseTransaction" IS DISTINCT FROM NEW."transactionId" OR r."releaseTransaction"<>txid_current()::text OR r.quantity<>NEW.quantity OR r."balanceId"<>NEW."balanceId" THEN RAISE EXCEPTION 'Hold delivery requires exact atomic full release' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_sales_stock_document AFTER INSERT ON "SalesStockDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_sales_stock_document();
CREATE FUNCTION erp_guard_sales_stock_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP<>'INSERT' AND (OLD.entity IN ('SalesStockDocument','SalesStockCancellation') OR (OLD.entity IN ('StockReservation','OrderStockReservation') AND EXISTS(SELECT 1 FROM "StockReservation" WHERE id::text=OLD."entityId" AND "salesDeliveryId" IS NOT NULL))) THEN RAISE EXCEPTION 'Sales stock audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.entity IN ('SalesStockDocument','SalesStockCancellation') AND (TG_OP<>'INSERT' OR pg_trigger_depth()<2) THEN RAISE EXCEPTION 'Sales stock audit is document-generated' USING ERRCODE='23514'; END IF;
 IF NEW.entity='StockMovement' AND NEW.action IN ('inventory-stock.reversed','inventory-stock.reversal-created') AND EXISTS(SELECT 1 FROM "StockMovement" WHERE "salesDocumentId" IS NOT NULL AND (id::text=NEW."entityId" OR id::text=NEW.metadata->>'originalId')) THEN RAISE EXCEPTION 'Sales stock document requires a source correction' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_sales_stock_audit BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_audit();
CREATE FUNCTION erp_guard_sales_stock_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='SalesOrder' THEN
  IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."quoteId",NEW.number,NEW."customerName") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."customerId",OLD."quoteId",OLD.number,OLD."customerName") AND EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE "orderId"=OLD.id) THEN RAISE EXCEPTION 'Physical stock source identity is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='SalesOrderLine' THEN
  IF NEW IS DISTINCT FROM OLD AND EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE "lineId"=OLD.id) THEN RAISE EXCEPTION 'Physical stock source line is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM (OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE "itemId"=OLD.id) THEN RAISE EXCEPTION 'Physical stock item scope is immutable' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_sales_stock_order BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_source();
CREATE TRIGGER guard_sales_stock_line BEFORE UPDATE ON "SalesOrderLine" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_source();
CREATE TRIGGER guard_sales_stock_item BEFORE UPDATE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_source();
-- Reserve/release mutations and sales stock requests cannot share a UUID. The
-- nested release is the sole exception and is bound bidirectionally below.
CREATE OR REPLACE FUNCTION erp_stock_reservation_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE request_id UUID;
BEGIN
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 IF TG_OP='INSERT' THEN request_id:=NEW.id;
 ELSIF NEW."releaseRequestId" IS NOT NULL AND NEW."releaseRequestId" IS DISTINCT FROM OLD."releaseRequestId" THEN request_id:=NEW."releaseRequestId";
 ELSE RETURN NEW;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-reservation-request:'||request_id::text,0));
 IF EXISTS(SELECT 1 FROM "SalesStockCancellation" WHERE id=request_id) OR EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE id=request_id) THEN RAISE EXCEPTION 'Request UUID belongs to a physical stock request' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM "StockReservation" WHERE "releaseRequestId"=request_id) THEN RAISE EXCEPTION 'Request ID already belongs to a release' USING ERRCODE='23514'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM "StockReservation" WHERE id=request_id) THEN RAISE EXCEPTION 'Request ID already belongs to a reservation creation' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE FUNCTION erp_guard_sales_hold_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."salesDeliveryId" IS NOT NULL THEN RAISE EXCEPTION 'A reservation must start without a delivery' USING ERRCODE='23514'; END IF;
 ELSIF NEW."salesDeliveryId" IS DISTINCT FROM OLD."salesDeliveryId" THEN
  IF OLD."salesDeliveryId" IS NOT NULL OR OLD."releasedAt" IS NOT NULL OR NEW."salesDeliveryId" IS NULL OR NEW."releaseRequestId" IS DISTINCT FROM NEW."salesDeliveryId" OR pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Hold delivery marker is only set by atomic delivery' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER a1_guard_sales_hold_marker BEFORE INSERT OR UPDATE ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_hold_marker();
CREATE FUNCTION erp_check_sales_hold_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."salesDeliveryId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "SalesStockDocument" d WHERE d.id=NEW."salesDeliveryId" AND d.kind='DELIVERY' AND d."holdId"=NEW.id AND d."releaseRequestId"=NEW."releaseRequestId" AND d."createdBy"=NEW."releasedBy" AND d."transactionId"=NEW."releaseTransaction" AND d."transactionId"=txid_current()::text AND d.quantity=NEW.quantity AND d."balanceId"=NEW."balanceId") THEN RAISE EXCEPTION 'Delivery-marked release requires its exact atomic document' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_sales_hold_marker AFTER INSERT OR UPDATE ON "StockReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_sales_hold_marker();
CREATE FUNCTION erp_guard_sales_stock_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE order_id UUID; branch_id UUID; d RECORD; action_name TEXT; held BOOLEAN;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Sales stock cancellation is permanent' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Sales stock cancellation requires READ COMMITTED for current authorization' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-stock:'||NEW.id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('stock-reservation-request:'||NEW.id::text,0));
 IF NEW.request->>'expectedActorId' IS DISTINCT FROM NEW."createdBy"::text OR NEW.request->>'requestId' IS DISTINCT FROM NEW.id::text OR NEW.request->>'tenantId' IS DISTINCT FROM NEW."tenantId"::text OR NEW.request->>'companyId' IS DISTINCT FROM NEW."companyId"::text OR EXISTS(SELECT 1 FROM "SalesStockDocument" WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM "StockReservation" WHERE id=NEW.id OR "releaseRequestId"=NEW.id) THEN RAISE EXCEPTION 'Request UUID or cancellation actor/scope mismatch' USING ERRCODE='23514'; END IF;
 action_name:=NEW.request->>'action';order_id:=(NEW.request->>'orderId')::uuid;held:=false;
 IF action_name='deliver' THEN
  branch_id:=(NEW.request->>'branchId')::uuid;held:=NEW.request->>'holdId' IS NOT NULL;
  IF NEW.request->>'physicalConfirmed' IS DISTINCT FROM 'true' OR NEW.request->>'itemId' IS NULL THEN RAISE EXCEPTION 'Invalid delivery cancellation payload' USING ERRCODE='23514'; END IF;
 ELSIF action_name IN ('return','correct') THEN
  SELECT * INTO d FROM "SalesStockDocument" WHERE id=(CASE WHEN action_name='return' THEN NEW.request->>'deliveryId' ELSE NEW.request->>'documentId' END)::uuid AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND "orderId"=order_id;
  IF d.id IS NULL OR (action_name='return' AND NEW.request->>'usableConfirmed' IS DISTINCT FROM 'true') OR (action_name='correct' AND NEW.request->>'physicalConfirmed' IS DISTINCT FROM 'true') THEN RAISE EXCEPTION 'Cancellation source or confirmation unavailable' USING ERRCODE='23514'; END IF;
  branch_id:=d."branchId";
 ELSE RAISE EXCEPTION 'Invalid sales stock cancellation action' USING ERRCODE='23514'; END IF;
 IF order_id IS NULL OR branch_id IS NULL OR NOT erp_sales_stock_rights(NEW."tenantId",NEW."companyId",order_id,branch_id,NEW."createdBy",held) OR length(coalesce(NEW.request->>'expectedUnit','')) NOT BETWEEN 1 AND 16 OR length(btrim(coalesce(NEW.request->>'reason',''))) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'Cancellation requires valid payload and current source and stock rights' USING ERRCODE='23514'; END IF;
 IF action_name<>'correct' AND (coalesce(NEW.request->>'quantity','') !~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$' OR (NEW.request->>'quantity')::numeric<=0 OR (NEW.request->>'quantity')::numeric>999999999.999 OR length(btrim(coalesce(NEW.request->>'reference',''))) NOT BETWEEN 3 AND 120) THEN RAISE EXCEPTION 'Invalid cancelled physical quantity or reference' USING ERRCODE='23514'; END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER guard_sales_stock_cancellation BEFORE INSERT OR UPDATE OR DELETE ON "SalesStockCancellation" FOR EACH ROW EXECUTE FUNCTION erp_guard_sales_stock_cancellation();
CREATE FUNCTION erp_audit_sales_stock_cancellation() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO "AuditLog"(id,"tenantId","actorId",action,entity,"entityId",metadata,"createdAt") VALUES(gen_random_uuid(),NEW."tenantId",NEW."createdBy",'sales-stock.request-cancelled','SalesStockCancellation',NEW.id::text,jsonb_build_object('request',NEW.request,'transactionId',txid_current()::text),NEW."createdAt");RETURN NULL;
END $$;
CREATE TRIGGER audit_sales_stock_cancellation AFTER INSERT ON "SalesStockCancellation" FOR EACH ROW EXECUTE FUNCTION erp_audit_sales_stock_cancellation();
ALTER TABLE "SalesStockDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesStockCancellation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SalesStockDocument","SalesStockCancellation" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_sales_stock_rights(UUID,UUID,UUID,UUID,UUID,BOOLEAN),erp_prepare_sales_stock(),erp_apply_sales_stock(),erp_guard_sales_stock_movement(),erp_check_sales_stock_document(),erp_guard_sales_stock_audit(),erp_guard_sales_stock_source(),erp_guard_sales_hold_marker(),erp_check_sales_hold_marker(),erp_guard_sales_stock_cancellation(),erp_audit_sales_stock_cancellation() FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
 EXECUTE format('REVOKE ALL ON "SalesStockDocument","SalesStockCancellation" FROM %I',r);
 EXECUTE format('REVOKE ALL ON FUNCTION erp_sales_stock_rights(UUID,UUID,UUID,UUID,UUID,BOOLEAN),erp_prepare_sales_stock(),erp_apply_sales_stock(),erp_guard_sales_stock_movement(),erp_check_sales_stock_document(),erp_guard_sales_stock_audit(),erp_guard_sales_stock_source(),erp_guard_sales_hold_marker(),erp_check_sales_hold_marker(),erp_guard_sales_stock_cancellation(),erp_audit_sales_stock_cancellation() FROM %I',r);
 END IF;END LOOP;END $$;

COMMIT;
