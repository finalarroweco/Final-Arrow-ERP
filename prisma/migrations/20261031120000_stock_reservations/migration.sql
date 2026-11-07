ALTER TABLE "StockBalance" ADD COLUMN "reservedQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0;
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_available_nonnegative" CHECK ("reservedQuantity">=0 AND quantity>="reservedQuantity");
CREATE TABLE "StockReservation" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "balanceId" UUID NOT NULL,
 quantity DECIMAL(18,3) NOT NULL CHECK (quantity>0 AND quantity<=999999999.999),
 reference VARCHAR(120) NOT NULL CHECK (length(trim(reference)) BETWEEN 3 AND 120),
 "createdBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "creationTransaction" TEXT NOT NULL DEFAULT (txid_current())::text,
 "releaseRequestId" UUID UNIQUE, "releasedBy" UUID, "releasedAt" TIMESTAMPTZ(3), "releaseReason" VARCHAR(200), "releaseTransaction" TEXT,
 CONSTRAINT "StockReservation_balance_fkey" FOREIGN KEY ("tenantId","balanceId") REFERENCES "StockBalance"("tenantId",id) ON DELETE RESTRICT,
 CONSTRAINT "StockReservation_release_check" CHECK (("releaseRequestId" IS NULL AND "releasedBy" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL AND "releaseTransaction" IS NULL) OR ("releaseRequestId" IS NOT NULL AND "releasedBy" IS NOT NULL AND "releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL AND length(trim("releaseReason")) BETWEEN 3 AND 200 AND "releaseTransaction" IS NOT NULL))
);
CREATE INDEX "StockReservation_tenantId_balanceId_createdAt_id_idx" ON "StockReservation"("tenantId","balanceId","createdAt",id);
ALTER TABLE "StockReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "StockReservation" FROM PUBLIC;
CREATE FUNCTION erp_apply_stock_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b RECORD; item RECORD; actor UUID;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reservation history cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO b FROM "StockBalance" WHERE id=NEW."balanceId" AND "tenantId"=NEW."tenantId" FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Reservation balance unavailable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO item FROM "InventoryItem" WHERE id=b."itemId";
  IF item."archivedAt" IS NOT NULL OR item."tenantId"<>b."tenantId" OR item."companyId"<>b."companyId" OR (item."branchId" IS NOT NULL AND item."branchId"<>b."branchId") THEN RAISE EXCEPTION 'Reservation item is archived or outside scope' USING ERRCODE='23514'; END IF;
  IF NEW."releaseRequestId" IS NOT NULL OR NEW."releasedBy" IS NOT NULL OR NEW."releasedAt" IS NOT NULL OR NEW."releaseReason" IS NOT NULL OR NEW."releaseTransaction" IS NOT NULL THEN RAISE EXCEPTION 'Reservation must start active' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM "StockReservation" WHERE "balanceId"=b.id)>=5000 THEN RAISE EXCEPTION 'Reservation history limit reached for this balance' USING ERRCODE='23514'; END IF;
  NEW."createdAt":=clock_timestamp(); NEW."creationTransaction":=txid_current()::text; actor:=NEW."createdBy";
  UPDATE "StockBalance" SET "reservedQuantity"="reservedQuantity"+NEW.quantity WHERE id=b.id;
 ELSE
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."balanceId" IS DISTINCT FROM OLD."balanceId" OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."creationTransaction" IS DISTINCT FROM OLD."creationTransaction" OR OLD."releasedAt" IS NOT NULL OR NEW."releaseRequestId" IS NULL OR NEW."releasedBy" IS NULL OR NEW."releaseReason" IS NULL THEN
   RAISE EXCEPTION 'Only one permanent reservation release is allowed' USING ERRCODE='23514'; END IF;
  NEW."releasedAt":=clock_timestamp(); NEW."releaseTransaction":=txid_current()::text; actor:=NEW."releasedBy";
  UPDATE "StockBalance" SET "reservedQuantity"="reservedQuantity"-NEW.quantity WHERE id=b.id;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Active reservation actor required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER apply_stock_reservation BEFORE INSERT OR UPDATE OR DELETE ON "StockReservation" FOR EACH ROW EXECUTE FUNCTION erp_apply_stock_reservation();
CREATE FUNCTION erp_check_reserved_balance() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b RECORD; total NUMERIC;
BEGIN
 SELECT * INTO b FROM "StockBalance" WHERE id=NEW.id;
 SELECT coalesce(sum(quantity),0) INTO total FROM "StockReservation" WHERE "balanceId"=NEW.id AND "releasedAt" IS NULL;
 IF b."reservedQuantity" IS DISTINCT FROM total THEN RAISE EXCEPTION 'Reserved balance must match active reservation history' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER check_reserved_balance AFTER INSERT OR UPDATE ON "StockBalance" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_check_reserved_balance();
CREATE FUNCTION erp_guard_reserved_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.id IS DISTINCT FROM OLD.id OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW."branchId" IS DISTINCT FROM OLD."branchId" OR NEW."itemId" IS DISTINCT FROM OLD."itemId") AND EXISTS(SELECT 1 FROM "StockReservation" WHERE "balanceId"=OLD.id) THEN RAISE EXCEPTION 'Reserved source scope is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_reserved_scope BEFORE UPDATE ON "StockBalance" FOR EACH ROW EXECUTE FUNCTION erp_guard_reserved_scope();
CREATE FUNCTION erp_audit_stock_reservation() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE action_name TEXT; actor UUID; txn TEXT;
BEGIN
 IF TG_OP='INSERT' THEN action_name:='inventory-stock.reserved'; actor:=NEW."createdBy"; txn:=NEW."creationTransaction";
 ELSE action_name:='inventory-stock.reservation-released'; actor:=NEW."releasedBy"; txn:=NEW."releaseTransaction"; END IF;
 IF txn<>txid_current()::text OR NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=actor AND a.action=action_name AND a.entity='StockReservation' AND a."entityId"=NEW.id::text AND a.metadata->>'balanceId'=NEW."balanceId"::text AND a.metadata->>'transactionId'=txn AND (TG_OP='INSERT' OR a.metadata->>'requestId'=NEW."releaseRequestId"::text)) THEN
 RAISE EXCEPTION 'Reservation change requires same-transaction audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER audit_stock_reservation AFTER INSERT OR UPDATE ON "StockReservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_audit_stock_reservation();
REVOKE ALL ON FUNCTION erp_apply_stock_reservation(),erp_check_reserved_balance(),erp_guard_reserved_scope(),erp_audit_stock_reservation() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "StockReservation" FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION erp_apply_stock_reservation(),erp_check_reserved_balance(),erp_guard_reserved_scope(),erp_audit_stock_reservation() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
