ALTER TABLE "Ticket" ADD COLUMN "resolutionDueAt" TIMESTAMPTZ(3),ADD COLUMN "deadlineSequence" INTEGER NOT NULL DEFAULT 0 CHECK("deadlineSequence" BETWEEN 0 AND 1000);
CREATE INDEX "Ticket_scope_status_deadline_idx" ON "Ticket"("tenantId","companyId","branchId",status,"resolutionDueAt",id);
CREATE TABLE "TicketDeadlineChange" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"ticketId" UUID NOT NULL,sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),"dueAt" TIMESTAMPTZ(3) CHECK("dueAt" IS NULL OR ("dueAt">='2000-01-01T00:00:00Z'::timestamptz AND "dueAt"<'2100-01-01T00:00:00Z'::timestamptz)),reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason))>=3),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"transactionId" TEXT NOT NULL DEFAULT (txid_current())::text,
 FOREIGN KEY("tenantId","companyId","ticketId") REFERENCES "Ticket"("tenantId","companyId",id) ON DELETE RESTRICT,UNIQUE("ticketId",sequence)
);
CREATE INDEX "TicketDeadlineChange_scope_sequence_idx" ON "TicketDeadlineChange"("tenantId","ticketId",sequence);
CREATE FUNCTION erp_ticket_deadline_projection_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW."deadlineSequence"<>0 OR NEW."resolutionDueAt" IS NOT NULL THEN RAISE EXCEPTION 'New tickets have no manually assigned deadline' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 IF OLD."deadlineSequence">0 AND ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") THEN RAISE EXCEPTION 'Ticket deadline source scope is immutable' USING ERRCODE='23514';END IF;
 IF ROW(NEW."resolutionDueAt",NEW."deadlineSequence") IS DISTINCT FROM ROW(OLD."resolutionDueAt",OLD."deadlineSequence") THEN
  IF pg_trigger_depth()<2 OR NEW."deadlineSequence"<>OLD."deadlineSequence"+1 OR NOT EXISTS(SELECT 1 FROM "TicketDeadlineChange" WHERE "ticketId"=OLD.id AND sequence=NEW."deadlineSequence" AND "dueAt" IS NOT DISTINCT FROM NEW."resolutionDueAt" AND "transactionId"=txid_current()::text) THEN RAISE EXCEPTION 'Ticket deadline requires its immutable current change' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER ticket_deadline_projection_guard BEFORE INSERT OR UPDATE ON "Ticket" FOR EACH ROW EXECUTE FUNCTION erp_ticket_deadline_projection_guard();
CREATE FUNCTION erp_ticket_deadline_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent "Ticket"%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM "Ticket" WHERE id=NEW."ticketId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL OR parent.status NOT IN('OPEN','IN_PROGRESS') OR NEW.sequence<>parent."deadlineSequence"+1 OR NEW."dueAt" IS NOT DISTINCT FROM parent."resolutionDueAt" THEN RAISE EXCEPTION 'Ticket is not active, deadline changed or unchanged value' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."createdBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Deadline change requires an active scoped actor' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp();NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;
CREATE TRIGGER ticket_deadline_guard BEFORE INSERT ON "TicketDeadlineChange" FOR EACH ROW EXECUTE FUNCTION erp_ticket_deadline_guard();
CREATE TRIGGER ticket_deadline_immutable BEFORE UPDATE OR DELETE ON "TicketDeadlineChange" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_ticket_deadline_apply() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN UPDATE "Ticket" SET "resolutionDueAt"=NEW."dueAt","deadlineSequence"=NEW.sequence,"updatedAt"=clock_timestamp() WHERE id=NEW."ticketId";RETURN NEW;END $$;
CREATE TRIGGER ticket_deadline_apply AFTER INSERT ON "TicketDeadlineChange" FOR EACH ROW EXECUTE FUNCTION erp_ticket_deadline_apply();
CREATE FUNCTION erp_ticket_deadline_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='TicketDeadlineChange' AND "entityId"=NEW.id::text AND action='ticket-deadline.changed' AND metadata->>'parentId'=NEW."ticketId"::text AND metadata->>'version'=NEW.sequence::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Deadline change requires its current transaction audit' USING ERRCODE='23514';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ticket_deadline_audit AFTER INSERT ON "TicketDeadlineChange" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_ticket_deadline_audit();
ALTER TABLE "TicketDeadlineChange" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "TicketDeadlineChange" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "TicketDeadlineChange" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_ticket_deadline_projection_guard(),erp_ticket_deadline_guard(),erp_ticket_deadline_apply(),erp_ticket_deadline_audit() FROM PUBLIC;
