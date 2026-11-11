-- A manual stock hold may have one immutable source association. It is not a
-- shipment, demand conversion, order-completion gate, invoice or ledger effect.
ALTER TABLE "StockReservation" ADD COLUMN "sourceKind" VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK("sourceKind" IN('MANUAL','ORDER_MANUAL'));
CREATE UNIQUE INDEX "StockBalance_tenantId_companyId_branchId_itemId_id_key" ON "StockBalance"("tenantId","companyId","branchId","itemId",id);
CREATE UNIQUE INDEX "StockReservation_tenantId_balanceId_id_key" ON "StockReservation"("tenantId","balanceId",id);
CREATE UNIQUE INDEX "SalesOrderLine_tenantId_orderId_id_key" ON "SalesOrderLine"("tenantId","orderId",id);
CREATE TABLE "OrderStockReservation" (
 "reservationId" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "branchId" UUID NOT NULL, "balanceId" UUID NOT NULL, "itemId" UUID NOT NULL,
 "orderId" UUID NOT NULL, "lineId" UUID,
 note VARCHAR(120) NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 120 AND note !~ '[[:cntrl:]]'),
 "orderNumber" TEXT NOT NULL, "customerName" TEXT NOT NULL,
 "linePosition" INTEGER, "lineDescription" TEXT,
 "itemSku" TEXT NOT NULL, "itemName" TEXT NOT NULL, "itemUnit" TEXT NOT NULL, "branchName" TEXT NOT NULL,
 CHECK(("lineId" IS NULL AND "linePosition" IS NULL AND "lineDescription" IS NULL) OR ("lineId" IS NOT NULL AND "linePosition" IS NOT NULL AND "lineDescription" IS NOT NULL)),
 FOREIGN KEY("tenantId","balanceId","reservationId") REFERENCES "StockReservation"("tenantId","balanceId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","branchId","itemId","balanceId") REFERENCES "StockBalance"("tenantId","companyId","branchId","itemId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","orderId") REFERENCES "SalesOrder"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","orderId","lineId") REFERENCES "SalesOrderLine"("tenantId","orderId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "OrderStockReservation_tenantId_balanceId_reservationId_key" ON "OrderStockReservation"("tenantId","balanceId","reservationId");
CREATE INDEX "OrderStockReservation_tenantId_orderId_branchId_reservationId_idx" ON "OrderStockReservation"("tenantId","orderId","branchId","reservationId");
CREATE INDEX "OrderStockReservation_itemId_idx" ON "OrderStockReservation"("itemId");
-- Reserve and release share one request namespace for new mutations. Existing
-- historical rows are unchanged; their exact application replays remain reads.
CREATE FUNCTION erp_stock_reservation_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('stock-reservation-request:'||NEW.id::text,0));
  IF EXISTS(SELECT 1 FROM "StockReservation" WHERE "releaseRequestId"=NEW.id) THEN RAISE EXCEPTION 'Request ID already belongs to a release' USING ERRCODE='23514'; END IF;
 ELSIF NEW."releaseRequestId" IS NOT NULL AND NEW."releaseRequestId" IS DISTINCT FROM OLD."releaseRequestId" THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('stock-reservation-request:'||NEW."releaseRequestId"::text,0));
  IF EXISTS(SELECT 1 FROM "StockReservation" WHERE id=NEW."releaseRequestId") THEN RAISE EXCEPTION 'Request ID already belongs to a reservation creation' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER a0_stock_reservation_request_guard BEFORE INSERT OR UPDATE ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_stock_reservation_request_guard();
-- Fires alphabetically before apply_stock_reservation's balance lock, so
-- direct SQL linked creation uses the same item -> balance order as receipts.
CREATE FUNCTION erp_order_stock_item_lock() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."sourceKind"='ORDER_MANUAL' THEN
  PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
  PERFORM i.id FROM "InventoryItem" i JOIN "StockBalance" b ON b."itemId"=i.id
   WHERE b.id=NEW."balanceId" AND b."tenantId"=NEW."tenantId" FOR SHARE OF i;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER aa_order_stock_item_lock BEFORE INSERT ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_item_lock();
CREATE FUNCTION erp_order_stock_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD; o RECORD; i RECORD; l RECORD;
BEGIN
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 -- The paired reservation's early trigger already acquired the item first.
 -- Repeating that lock here also makes an invalid direct association fail safe.
 PERFORM id FROM "InventoryItem" WHERE id=NEW."itemId" FOR SHARE;
 PERFORM id FROM "StockBalance" WHERE id=NEW."balanceId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 SELECT * INTO r FROM "StockReservation" WHERE id=NEW."reservationId" AND "tenantId"=NEW."tenantId" AND "balanceId"=NEW."balanceId";
 IF r.id IS NULL OR r."creationTransaction"<>txid_current()::text OR r."releasedAt" IS NOT NULL OR r.reference<>'Order-linked manual hold' OR r."sourceKind"<>'ORDER_MANUAL' THEN
  RAISE EXCEPTION 'Only a newly created active reservation can acquire an order association' USING ERRCODE='23514'; END IF;
 SELECT * INTO o FROM "SalesOrder" WHERE id=NEW."orderId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF o.id IS NULL OR o.status NOT IN('NEW','IN_PROGRESS') OR (o."branchId" IS NOT NULL AND o."branchId"<>NEW."branchId") THEN
  RAISE EXCEPTION 'New order hold requires an active order and matching branch' USING ERRCODE='23514'; END IF;
 IF NOT erp_payment_term_actor_access(r."createdBy",NEW."tenantId",NEW."companyId",o."branchId",'order:read') OR
 NOT erp_payment_term_actor_access(r."createdBy",NEW."tenantId",NEW."companyId",o."branchId",'order-reservation:manage') OR
 NOT erp_payment_term_actor_access(r."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'inventory-stock:read') OR
 NOT erp_payment_term_actor_access(r."createdBy",NEW."tenantId",NEW."companyId",NEW."branchId",'inventory-stock:adjust') THEN
  RAISE EXCEPTION 'Order hold actor lacks current source and stock authorization' USING ERRCODE='23514'; END IF;
 SELECT * INTO i FROM "InventoryItem" WHERE id=NEW."itemId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR SHARE;
 IF i.id IS NULL OR i."archivedAt" IS NOT NULL OR (i."branchId" IS NOT NULL AND i."branchId"<>NEW."branchId") THEN
  RAISE EXCEPTION 'Order hold item unavailable' USING ERRCODE='23514'; END IF;
 -- Supplied unit is the operator's expected stock unit, not an inferred label.
 IF NEW."itemUnit" IS DISTINCT FROM i.unit THEN
  RAISE EXCEPTION 'Stock unit changed since the hold was prepared; no conversion is performed' USING ERRCODE='23514'; END IF;
 NEW."orderNumber":=o.number; NEW."customerName":=o."customerName";
 NEW."itemSku":=i.sku;NEW."itemName":=i.name;NEW."itemUnit":=i.unit;
 SELECT name INTO NEW."branchName" FROM "Branch" WHERE id=NEW."branchId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR SHARE;
 IF NEW."lineId" IS NOT NULL THEN
  SELECT * INTO l FROM "SalesOrderLine" WHERE id=NEW."lineId" AND "tenantId"=NEW."tenantId" AND "orderId"=NEW."orderId" FOR SHARE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'Source line does not belong to order' USING ERRCODE='23514'; END IF;
  NEW."linePosition":=l.position; NEW."lineDescription":=l.description;
 ELSE NEW."linePosition":=NULL; NEW."lineDescription":=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_stock_link_guard BEFORE INSERT ON "OrderStockReservation" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_link_guard();
CREATE TRIGGER order_stock_link_immutable BEFORE UPDATE OR DELETE ON "OrderStockReservation" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_order_stock_link_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r RECORD;
BEGIN
 SELECT * INTO r FROM "StockReservation" WHERE id=NEW."reservationId";
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=r."createdBy" AND entity='OrderStockReservation' AND "entityId"=NEW."reservationId"::text AND action='order-stock.reserved' AND metadata->>'orderId'=NEW."orderId"::text AND metadata->>'transactionId'=r."creationTransaction" AND r."creationTransaction"=txid_current()::text) THEN
  RAISE EXCEPTION 'Order association requires its same-transaction audit' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_stock_link_audit AFTER INSERT ON "OrderStockReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_order_stock_link_audit();
CREATE FUNCTION erp_order_stock_release_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE link RECORD; source_branch UUID;
BEGIN
 SELECT * INTO link FROM "OrderStockReservation" WHERE "reservationId"=OLD.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 PERFORM id FROM "Tenant" WHERE id=OLD."tenantId" FOR SHARE;
 PERFORM id FROM "StockBalance" WHERE id=OLD."balanceId" FOR UPDATE;
 SELECT "branchId" INTO source_branch FROM "SalesOrder" WHERE id=link."orderId" FOR UPDATE;
 IF NOT erp_payment_term_actor_access(NEW."releasedBy",link."tenantId",link."companyId",source_branch,'order:read') OR
 NOT erp_payment_term_actor_access(NEW."releasedBy",link."tenantId",link."companyId",source_branch,'order-reservation:manage') OR
 NOT erp_payment_term_actor_access(NEW."releasedBy",link."tenantId",link."companyId",link."branchId",'inventory-stock:read') OR
 NOT erp_payment_term_actor_access(NEW."releasedBy",link."tenantId",link."companyId",link."branchId",'inventory-stock:adjust') THEN
  RAISE EXCEPTION 'Linked release requires current source and stock authorization' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_stock_release_guard BEFORE UPDATE ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_release_guard();
CREATE FUNCTION erp_order_stock_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='StockReservation' THEN
  IF NEW."sourceKind" IS DISTINCT FROM OLD."sourceKind" THEN RAISE EXCEPTION 'Reservation classification is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='SalesOrder' THEN
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId",NEW."customerId",NEW."quoteId",NEW.number,NEW."customerName") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId",OLD."customerId",OLD."quoteId",OLD.number,OLD."customerName") AND EXISTS(SELECT 1 FROM "OrderStockReservation" WHERE "orderId"=OLD.id) THEN
   RAISE EXCEPTION 'Linked order source identity is immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='SalesOrderLine' THEN
  IF NEW IS DISTINCT FROM OLD AND EXISTS(SELECT 1 FROM "OrderStockReservation" WHERE "lineId"=OLD.id) THEN
   RAISE EXCEPTION 'Linked source line is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND EXISTS(SELECT 1 FROM "OrderStockReservation" WHERE "itemId"=OLD.id) THEN
   RAISE EXCEPTION 'Linked item scope is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS(SELECT 1 FROM "OrderStockReservation" l JOIN "StockReservation" r ON r.id=l."reservationId" WHERE l."itemId"=OLD.id AND r."releasedAt" IS NULL) THEN
   RAISE EXCEPTION 'Release all active order-linked holds before changing the stock unit; no conversion is performed' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER order_stock_kind_guard BEFORE UPDATE ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_source_guard();
CREATE TRIGGER order_stock_source_guard BEFORE UPDATE ON "SalesOrder" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_source_guard();
CREATE TRIGGER order_stock_line_guard BEFORE UPDATE ON "SalesOrderLine" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_source_guard();
CREATE TRIGGER order_stock_unit_guard BEFORE UPDATE ON "InventoryItem" FOR EACH ROW EXECUTE FUNCTION erp_order_stock_source_guard();
ALTER TABLE "OrderStockReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "OrderStockReservation" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_stock_reservation_request_guard(),erp_order_stock_item_lock(),erp_order_stock_link_guard(),erp_order_stock_link_audit(),erp_order_stock_release_guard(),erp_order_stock_source_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
  EXECUTE format('REVOKE ALL ON "OrderStockReservation" FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION erp_stock_reservation_request_guard(),erp_order_stock_item_lock(),erp_order_stock_link_guard(),erp_order_stock_link_audit(),erp_order_stock_release_guard(),erp_order_stock_source_guard() FROM %I',role_name);
 END IF;END LOOP;END $$;
INSERT INTO "Permission"(key) VALUES('order-reservation:manage') ON CONFLICT DO NOTHING;
-- Separate explicit permission: order lifecycle management alone is not permission to reserve stock.
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,'order-reservation:manage' FROM "Role" WHERE name='Owner' ON CONFLICT DO NOTHING;

CREATE FUNCTION erp_order_stock_pair_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE linked BOOLEAN; order_id UUID;
BEGIN
 SELECT "orderId" INTO order_id FROM "OrderStockReservation" WHERE "reservationId"=NEW.id;
 linked:=FOUND;
 IF (NEW."sourceKind"='ORDER_MANUAL') IS DISTINCT FROM linked THEN RAISE EXCEPTION 'Order-linked reservation and source association must be created together' USING ERRCODE='23514'; END IF;
 IF linked AND TG_OP='UPDATE' AND NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."releasedBy" AND entity='OrderStockReservation' AND "entityId"=NEW.id::text AND action='order-stock.released' AND metadata->>'orderId'=order_id::text AND metadata->>'transactionId'=NEW."releaseTransaction" AND metadata->>'requestId'=NEW."releaseRequestId"::text AND NEW."releaseTransaction"=txid_current()::text) THEN
 RAISE EXCEPTION 'Linked release requires its same-transaction source audit' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER order_stock_pair_guard AFTER INSERT OR UPDATE ON "StockReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_order_stock_pair_guard();
REVOKE ALL ON FUNCTION erp_order_stock_pair_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN EXECUTE format('REVOKE ALL ON FUNCTION erp_order_stock_pair_guard() FROM %I',role_name); END IF;
END LOOP;END $$;
