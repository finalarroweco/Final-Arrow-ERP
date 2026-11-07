CREATE TABLE "CustomerContact" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"customerId" UUID NOT NULL,
 "displayName" VARCHAR(160) NOT NULL CHECK(length(trim("displayName"))>=2),email VARCHAR(255),phone VARCHAR(40),title VARCHAR(120),notes VARCHAR(2000),"archivedAt" TIMESTAMP(3),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdBy" UUID NOT NULL,"updatedBy" UUID NOT NULL,
 FOREIGN KEY("tenantId","companyId","customerId") REFERENCES "Customer"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE INDEX "CustomerContact_scope_name_idx" ON "CustomerContact"("tenantId","customerId","archivedAt","displayName");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tenantId_companyId_id_key" UNIQUE("tenantId","companyId",id);
CREATE TABLE "TicketMessage" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"ticketId" UUID NOT NULL,body VARCHAR(4000) NOT NULL CHECK(length(trim(body))>=1 AND body ~ '[^[:space:]]'),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId","ticketId") REFERENCES "Ticket"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE INDEX "TicketMessage_scope_created_idx" ON "TicketMessage"("tenantId","ticketId","createdAt",id);
CREATE FUNCTION erp_customer_contact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent "Customer"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contacts must be archived, not deleted' USING ERRCODE='23514';END IF;
 SELECT * INTO parent FROM "Customer" WHERE id=NEW."customerId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL OR parent."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'Restore the customer before changing contacts' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."updatedBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Contact requires an active scoped actor' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW."archivedAt" IS NOT NULL OR NEW."createdBy"<>NEW."updatedBy" OR (SELECT count(*) FROM "CustomerContact" WHERE "customerId"=NEW."customerId")>=1000 THEN RAISE EXCEPTION 'Invalid new contact or contact limit reached' USING ERRCODE='23514';END IF;
  NEW."createdAt":=clock_timestamp();
 ELSE
  IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."customerId",NEW."createdBy",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."customerId",OLD."createdBy",OLD."createdAt") OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Contact scope and history are immutable; increment its version' USING ERRCODE='23514';END IF;
  IF OLD."archivedAt" IS NOT NULL AND NEW."archivedAt" IS NOT NULL THEN RAISE EXCEPTION 'Restore the contact before editing' USING ERRCODE='23514';END IF;
  IF NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
   IF ROW(NEW."displayName",NEW.email,NEW.phone,NEW.title,NEW.notes) IS DISTINCT FROM ROW(OLD."displayName",OLD.email,OLD.phone,OLD.title,OLD.notes) THEN RAISE EXCEPTION 'Archive and content changes must be separate' USING ERRCODE='23514';END IF;
   IF NEW."archivedAt" IS NOT NULL THEN NEW."archivedAt":=clock_timestamp();END IF;
  END IF;
 END IF;
 NEW."updatedAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER customer_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON "CustomerContact" FOR EACH ROW EXECUTE FUNCTION erp_customer_contact_guard();
CREATE FUNCTION erp_ticket_message_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE parent "Ticket"%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM "Ticket" WHERE id=NEW."ticketId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" FOR UPDATE;
 IF parent.id IS NULL OR parent.status='CLOSED' OR (SELECT count(*) FROM "TicketMessage" WHERE "ticketId"=NEW."ticketId")>=5000 THEN RAISE EXCEPTION 'Ticket is closed or message limit reached' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM "Membership" WHERE "tenantId"=NEW."tenantId" AND "userId"=NEW."createdBy" AND status='ACTIVE') THEN RAISE EXCEPTION 'Message requires an active scoped actor' USING ERRCODE='23514';END IF;
 NEW."createdAt":=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER ticket_message_guard BEFORE INSERT ON "TicketMessage" FOR EACH ROW EXECUTE FUNCTION erp_ticket_message_guard();
CREATE TRIGGER ticket_message_immutable BEFORE UPDATE OR DELETE ON "TicketMessage" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_operational_child_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actor UUID;action_name TEXT;parent_id UUID;version_number INTEGER;
BEGIN
 IF TG_TABLE_NAME='CustomerContact' THEN actor:=NEW."updatedBy";parent_id:=NEW."customerId";version_number:=NEW.version;action_name:=CASE WHEN TG_OP='INSERT' THEN 'customer-contact.created' WHEN NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN CASE WHEN NEW."archivedAt" IS NULL THEN 'customer-contact.restored' ELSE 'customer-contact.archived' END ELSE 'customer-contact.updated' END;
 ELSE actor:=NEW."createdBy";parent_id:=NEW."ticketId";version_number:=1;action_name:='ticket-message.created';END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=actor AND entity=TG_TABLE_NAME AND "entityId"=NEW.id::text AND action=action_name AND metadata->>'parentId'=parent_id::text AND metadata->>'version'=version_number::text AND metadata->>'transaction'=txid_current()::text) THEN RAISE EXCEPTION 'Operational record requires its current transaction audit' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_contact_audit AFTER INSERT OR UPDATE ON "CustomerContact" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_operational_child_audit();
CREATE CONSTRAINT TRIGGER ticket_message_audit AFTER INSERT ON "TicketMessage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_operational_child_audit();
ALTER TABLE "CustomerContact" ENABLE ROW LEVEL SECURITY;ALTER TABLE "TicketMessage" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CustomerContact","TicketMessage" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CustomerContact","TicketMessage" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_customer_contact_guard(),erp_ticket_message_guard(),erp_operational_child_audit() FROM PUBLIC;
