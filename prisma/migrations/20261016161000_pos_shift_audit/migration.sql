ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_lifecycle_complete" CHECK(("closedAt" IS NULL AND num_nulls("closedBy","countedCash","expectedCash",difference,"closeReason")=5) OR ("closedAt" IS NOT NULL AND num_nulls("closedBy","countedCash","expectedCash",difference,"closeReason")=0));
CREATE FUNCTION erp_pos_shift_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE action_name TEXT;actor UUID;
BEGIN
 IF TG_TABLE_NAME='PosShiftEvent' THEN
  IF NEW.kind NOT IN('IN','OUT') THEN RETURN NULL;END IF;
  IF NEW."createdBy" IS NULL OR NOT EXISTS(SELECT 1 FROM "AuditLog" a JOIN "PosShift" s ON s.id=NEW."shiftId" WHERE a."tenantId"=s."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity='PosShiftEvent' AND a."entityId"=NEW.id::text AND a.action='pos-shift.cash-recorded' AND a.metadata->>'shiftId'=s.id::text AND a.metadata->>'kind'=NEW.kind AND (a.metadata->>'amount')::numeric=NEW.amount) THEN RAISE EXCEPTION 'Manual drawer event requires its scoped audit' USING ERRCODE='23514';END IF;
 ELSE
  action_name:=CASE WHEN TG_OP='INSERT' THEN 'pos-shift.opened' ELSE 'pos-shift.closed' END;actor:=CASE WHEN TG_OP='INSERT' THEN NEW."openedBy" ELSE NEW."closedBy" END;
  IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=actor AND entity='PosShift' AND "entityId"=NEW.id::text AND action=action_name) THEN RAISE EXCEPTION 'Shift transition requires its scoped audit' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_shift_transition_audit AFTER INSERT OR UPDATE ON "PosShift" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_audit();
CREATE CONSTRAINT TRIGGER pos_shift_cash_audit AFTER INSERT ON "PosShiftEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_pos_shift_audit();
REVOKE EXECUTE ON FUNCTION erp_pos_shift_audit() FROM PUBLIC;
