CREATE TABLE "PosShift" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"branchId" UUID NOT NULL,number VARCHAR(30) NOT NULL CHECK(number ~ '^[A-Z0-9-]{2,30}$'),currency VARCHAR(3) NOT NULL,
 "openingCash" NUMERIC(18,3) NOT NULL CHECK("openingCash" BETWEEN 0 AND 999999999999999.999),"openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"openedBy" UUID NOT NULL,
 "closedAt" TIMESTAMP(3),"closedBy" UUID,"countedCash" NUMERIC(18,3),"expectedCash" NUMERIC(18,3),difference NUMERIC(18,3),"closeReason" VARCHAR(500),
 FOREIGN KEY("tenantId","companyId","branchId") REFERENCES "Branch"("tenantId","companyId",id) ON DELETE RESTRICT,
 UNIQUE("tenantId","companyId","branchId",id),UNIQUE("branchId",number),
 CHECK(("closedAt" IS NULL AND "closedBy" IS NULL AND "countedCash" IS NULL AND "expectedCash" IS NULL AND difference IS NULL AND "closeReason" IS NULL) OR ("closedAt">="openedAt" AND "closedBy" IS NOT NULL AND "countedCash" IS NOT NULL AND "expectedCash" IS NOT NULL AND difference IS NOT NULL AND "countedCash" BETWEEN 0 AND 999999999999999.999 AND "expectedCash" BETWEEN 0 AND 999999999999999.999 AND difference="countedCash"-"expectedCash" AND "closeReason" IS NOT NULL AND (difference=0 OR length(trim("closeReason"))>=3)))
);
CREATE UNIQUE INDEX "PosShift_one_open_branch" ON "PosShift"("branchId") WHERE "closedAt" IS NULL;
CREATE INDEX "PosShift_scope_opened_idx" ON "PosShift"("tenantId","companyId","branchId","openedAt");
CREATE TABLE "PosShiftEvent" (
 id UUID PRIMARY KEY,"shiftId" UUID NOT NULL REFERENCES "PosShift"(id) ON DELETE RESTRICT,kind VARCHAR(10) NOT NULL CHECK(kind IN('PAYMENT','REFUND','IN','OUT')),
 "orderId" UUID UNIQUE REFERENCES "PosOrder"(id) ON DELETE RESTRICT,"refundId" UUID UNIQUE REFERENCES "PosRefund"(id) ON DELETE RESTRICT,
 amount NUMERIC(18,3) NOT NULL CHECK(amount>0 AND amount<1000000000000000),"cashDelta" NUMERIC(18,3) NOT NULL CHECK("cashDelta" BETWEEN -999999999999999.999 AND 999999999999999.999),reference VARCHAR(120) NOT NULL CHECK(length(trim(reference))>=2),reason VARCHAR(500) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdBy" UUID,
 CHECK((kind='PAYMENT' AND "orderId" IS NOT NULL AND "refundId" IS NULL) OR (kind='REFUND' AND "orderId" IS NULL AND "refundId" IS NOT NULL) OR (kind IN('IN','OUT') AND "orderId" IS NULL AND "refundId" IS NULL AND length(trim(reason))>=3))
);
CREATE INDEX "PosShiftEvent_shift_created_idx" ON "PosShiftEvent"("shiftId","createdAt");
CREATE FUNCTION erp_pos_shift_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE total NUMERIC;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Shift history cannot be deleted' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" FOR SHARE;
 PERFORM 1 FROM "Branch" WHERE id=NEW."branchId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW."closedAt" IS NOT NULL OR NOT EXISTS(SELECT 1 FROM "Company" WHERE id=NEW."companyId" AND "tenantId"=NEW."tenantId" AND "baseCurrency"=NEW.currency) THEN RAISE EXCEPTION 'New shift must be open and use company currency' USING ERRCODE='23514';END IF;
  NEW."openedAt":=clock_timestamp();RETURN NEW;
 END IF;
 IF OLD."closedAt" IS NOT NULL OR NEW."closedAt" IS NULL OR (to_jsonb(NEW)-ARRAY['closedAt','closedBy','countedCash','expectedCash','difference','closeReason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['closedAt','closedBy','countedCash','expectedCash','difference','closeReason']) THEN RAISE EXCEPTION 'Only closing an open shift is allowed' USING ERRCODE='23514';END IF;
 SELECT OLD."openingCash"+COALESCE(sum("cashDelta"),0) INTO total FROM "PosShiftEvent" WHERE "shiftId"=OLD.id;
 IF NEW."expectedCash" IS DISTINCT FROM total OR NEW.difference IS DISTINCT FROM NEW."countedCash"-total THEN RAISE EXCEPTION 'Shift closure must preserve exact recorded cash' USING ERRCODE='23514';END IF;
 NEW."closedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER pos_shift_guard BEFORE INSERT OR UPDATE OR DELETE ON "PosShift" FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_guard();
CREATE FUNCTION erp_pos_shift_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE s "PosShift"%ROWTYPE; o "PosOrder"%ROWTYPE; f "PosRefund"%ROWTYPE; expected NUMERIC;
BEGIN
 SELECT * INTO s FROM "PosShift" WHERE id=NEW."shiftId";
 PERFORM 1 FROM "Branch" WHERE id=s."branchId" FOR UPDATE;
 SELECT * INTO s FROM "PosShift" WHERE id=NEW."shiftId";
 IF s.id IS NULL OR s."closedAt" IS NOT NULL OR (SELECT count(*) FROM "PosShiftEvent" WHERE "shiftId"=s.id)>=5000 THEN RAISE EXCEPTION 'Shift is closed or reached 5000 events' USING ERRCODE='23514';END IF;
 IF NEW.kind IN('PAYMENT','REFUND') THEN
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Payment/refund events require original source transition' USING ERRCODE='23514';END IF;
  IF NEW.kind='REFUND' THEN SELECT * INTO f FROM "PosRefund" WHERE id=NEW."refundId";SELECT * INTO o FROM "PosOrder" WHERE id=f."orderId";expected:=CASE WHEN o."paymentMethod"='CASH' THEN -f.amount ELSE 0 END;
  ELSE SELECT * INTO o FROM "PosOrder" WHERE id=NEW."orderId";expected:=CASE WHEN o."paymentMethod"='CASH' THEN o.total ELSE 0 END;END IF;
  IF o.id IS NULL OR o.status<>'PAID' OR ROW(o."tenantId",o."companyId",o."branchId",o.currency) IS DISTINCT FROM ROW(s."tenantId",s."companyId",s."branchId",s.currency) OR NEW.amount IS DISTINCT FROM (CASE WHEN NEW.kind='PAYMENT' THEN o.total ELSE f.amount END) OR NEW."cashDelta"<>expected THEN RAISE EXCEPTION 'Shift event must match its source amounts and scope' USING ERRCODE='23514';END IF;
 ELSE
  IF NEW."cashDelta"<>(CASE WHEN NEW.kind='IN' THEN NEW.amount ELSE -NEW.amount END) THEN RAISE EXCEPTION 'Invalid cash movement amount' USING ERRCODE='23514';END IF;
 END IF;
 IF s."openingCash"+COALESCE((SELECT sum("cashDelta") FROM "PosShiftEvent" WHERE "shiftId"=s.id),0)+NEW."cashDelta"<0 THEN RAISE EXCEPTION 'Insufficient recorded drawer cash; record actual cash in first' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER pos_shift_event_guard BEFORE INSERT ON "PosShiftEvent" FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_event_guard();
CREATE TRIGGER pos_shift_event_immutable BEFORE UPDATE OR DELETE ON "PosShiftEvent" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_pos_shift_source_event() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o "PosOrder"%ROWTYPE;s "PosShift"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='PosOrder' THEN
  IF NEW.status<>'PAID' OR OLD.status='PAID' THEN RETURN NEW;END IF;o:=NEW;
 ELSE SELECT * INTO o FROM "PosOrder" WHERE id=NEW."orderId";END IF;
 PERFORM 1 FROM "Branch" WHERE id=o."branchId" FOR UPDATE;
 SELECT * INTO s FROM "PosShift" WHERE "branchId"=o."branchId" AND "closedAt" IS NULL;
 IF s.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM "PosShift" WHERE "branchId"=o."branchId") THEN RAISE EXCEPTION 'Open a branch shift before recording payments or refunds' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='PosOrder' THEN
  INSERT INTO "PosShiftEvent"(id,"shiftId",kind,"orderId",amount,"cashDelta",reference,reason,"createdBy") VALUES(gen_random_uuid(),s.id,'PAYMENT',o.id,o.total,CASE WHEN o."paymentMethod"='CASH' THEN o.total ELSE 0 END,o.number,'Recorded POS payment',NULLIF(current_setting('erp.pos_actor',true),'')::uuid);
 ELSE
  INSERT INTO "PosShiftEvent"(id,"shiftId",kind,"refundId",amount,"cashDelta",reference,reason,"createdBy") VALUES(gen_random_uuid(),s.id,'REFUND',NEW.id,NEW.amount,CASE WHEN o."paymentMethod"='CASH' THEN -NEW.amount ELSE 0 END,NEW.reference,NEW.reason,NEW."createdBy");
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_shift_payment_event AFTER UPDATE ON "PosOrder" FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_source_event();
CREATE TRIGGER pos_shift_refund_event AFTER INSERT ON "PosRefund" FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_source_event();
ALTER TABLE "PosShift" ENABLE ROW LEVEL SECURITY;ALTER TABLE "PosShiftEvent" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PosShift","PosShiftEvent" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PosShift","PosShiftEvent" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_pos_shift_guard(),erp_pos_shift_event_guard(),erp_pos_shift_source_event() FROM PUBLIC;
