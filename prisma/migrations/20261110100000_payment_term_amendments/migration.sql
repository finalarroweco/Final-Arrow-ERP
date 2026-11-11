-- Original source snapshots remain immutable. Amendments record an operator's
-- already-approved terms, never change money, and cannot be backdated.
CREATE TABLE "PaymentTermAmendment" (
 id UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "branchId" UUID,
 "invoiceId" UUID, "receiptId" UUID,
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 1000),
 "paymentTerms" VARCHAR(120), "paymentDueDate" DATE,
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 1000 AND reason !~ '[[:cntrl:]]'),
 "createdBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "transactionId" TEXT NOT NULL DEFAULT (txid_current())::text,
 CHECK(("invoiceId" IS NOT NULL)::int + ("receiptId" IS NOT NULL)::int = 1),
 CHECK(("paymentTerms" IS NULL AND "paymentDueDate" IS NULL) OR
  ("paymentTerms" IS NOT NULL AND length(btrim("paymentTerms")) BETWEEN 3 AND 120 AND "paymentTerms" !~ '[[:cntrl:]]' AND "paymentDueDate" IS NOT NULL AND "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31')),
 FOREIGN KEY("tenantId","companyId","invoiceId") REFERENCES "Invoice"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","receiptId") REFERENCES "GoodsReceipt"("tenantId","companyId",id) ON DELETE RESTRICT,
 UNIQUE("invoiceId",sequence), UNIQUE("receiptId",sequence)
);
CREATE INDEX "PaymentTermAmendment_tenantId_invoiceId_createdAt_sequence_idx" ON "PaymentTermAmendment"("tenantId","invoiceId","createdAt",sequence);
CREATE INDEX "PaymentTermAmendment_tenantId_receiptId_createdAt_sequence_idx" ON "PaymentTermAmendment"("tenantId","receiptId","createdAt",sequence);
CREATE FUNCTION erp_payment_term_actor_access(actor UUID, tenant UUID, company UUID, branch UUID, permission TEXT) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM "Membership" m
 JOIN "RoleGrant" g ON g."tenantId"=m."tenantId" AND g."membershipId"=m.id
 JOIN "RolePermission" p ON p."tenantId"=g."tenantId" AND p."roleId"=g."roleId"
 JOIN "AccessScope" s ON s."tenantId"=g."tenantId" AND s."grantId"=g.id
 WHERE m."tenantId"=tenant AND m."userId"=actor AND m.status='ACTIVE' AND p."permissionKey"=permission
 AND (s.type='TENANT' OR (s."companyId"=company AND (s.type='COMPANY' OR (s.type='BRANCH' AND branch IS NOT NULL AND s."branchId"=branch)))));
$$;
CREATE FUNCTION erp_payment_term_amendment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_branch UUID; original_terms TEXT; original_due DATE; previous "PaymentTermAmendment"%ROWTYPE; order_branch UUID;
BEGIN
 PERFORM id FROM "Tenant" WHERE id=NEW."tenantId" FOR SHARE;
 IF NEW."invoiceId" IS NOT NULL AND NEW."receiptId" IS NULL THEN
  SELECT "branchId","paymentTerms","paymentDueDate" INTO source_branch,original_terms,original_due FROM "Invoice"
   WHERE id=NEW."invoiceId" AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId" AND status IN('DRAFT','ISSUED') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment requires an available non-void invoice' USING ERRCODE='23514'; END IF;
  IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",source_branch,'invoice:read') OR
     NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",source_branch,'invoice-payment-term:manage') THEN
   RAISE EXCEPTION 'Amendment actor lacks current invoice authorization' USING ERRCODE='23514'; END IF;
  SELECT * INTO previous FROM "PaymentTermAmendment" WHERE "invoiceId"=NEW."invoiceId" ORDER BY sequence DESC LIMIT 1;
 ELSIF NEW."receiptId" IS NOT NULL AND NEW."invoiceId" IS NULL THEN
  SELECT r."branchId",r."paymentTerms",r."paymentDueDate",o."branchId" INTO source_branch,original_terms,original_due,order_branch
   FROM "GoodsReceipt" r JOIN "PurchaseOrder" o ON o.id=r."orderId"
   WHERE r.id=NEW."receiptId" AND r."tenantId"=NEW."tenantId" AND r."companyId"=NEW."companyId" FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Amendment receipt unavailable' USING ERRCODE='23514'; END IF;
  IF NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",source_branch,'inventory-stock:read') OR
     NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",order_branch,'purchase-order:read') OR
     NOT erp_payment_term_actor_access(NEW."createdBy",NEW."tenantId",NEW."companyId",source_branch,'receipt-payment-term:manage') THEN
   RAISE EXCEPTION 'Amendment actor lacks current receipt authorization' USING ERRCODE='23514'; END IF;
  SELECT * INTO previous FROM "PaymentTermAmendment" WHERE "receiptId"=NEW."receiptId" ORDER BY sequence DESC LIMIT 1;
 ELSE RAISE EXCEPTION 'Exactly one amendment source is required' USING ERRCODE='23514'; END IF;
 IF NEW."branchId" IS DISTINCT FROM source_branch OR NEW.sequence<>coalesce(previous.sequence,0)+1 THEN
  RAISE EXCEPTION 'Amendment scope or sequence mismatch' USING ERRCODE='23514'; END IF;
 IF previous.id IS NOT NULL THEN original_terms:=previous."paymentTerms";original_due:=previous."paymentDueDate"; END IF;
 IF ROW(NEW."paymentTerms",NEW."paymentDueDate") IS NOT DISTINCT FROM ROW(original_terms,original_due) THEN
  RAISE EXCEPTION 'Amendment must change the recorded terms' USING ERRCODE='23514'; END IF;
 -- Nondecreasing timestamps preserve append order even if the server clock moves back.
 NEW."createdAt":=greatest(clock_timestamp(),previous."createdAt");NEW."transactionId":=txid_current()::text;RETURN NEW;
END $$;
CREATE TRIGGER payment_term_amendment_guard BEFORE INSERT ON "PaymentTermAmendment" FOR EACH ROW EXECUTE FUNCTION erp_payment_term_amendment_guard();
CREATE TRIGGER payment_term_amendment_immutable BEFORE UPDATE OR DELETE ON "PaymentTermAmendment" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_payment_term_amendment_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."transactionId"<>txid_current()::text OR NOT EXISTS(SELECT 1 FROM "AuditLog" WHERE "tenantId"=NEW."tenantId" AND "actorId"=NEW."createdBy" AND entity='PaymentTermAmendment' AND "entityId"=NEW.id::text AND action='payment-term.amended' AND metadata->>'parentId'=coalesce(NEW."invoiceId",NEW."receiptId")::text AND metadata->>'version'=NEW.sequence::text AND metadata->>'transaction'=txid_current()::text) THEN
  RAISE EXCEPTION 'Payment amendment requires its same-transaction audit' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payment_term_amendment_audit AFTER INSERT ON "PaymentTermAmendment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_payment_term_amendment_audit();
CREATE FUNCTION erp_payment_term_source_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF ROW(NEW.id,NEW."tenantId",NEW."companyId",NEW."branchId") IS DISTINCT FROM ROW(OLD.id,OLD."tenantId",OLD."companyId",OLD."branchId") AND
 EXISTS(SELECT 1 FROM "PaymentTermAmendment" WHERE (TG_TABLE_NAME='Invoice' AND "invoiceId"=OLD.id) OR (TG_TABLE_NAME='GoodsReceipt' AND "receiptId"=OLD.id)) THEN
  RAISE EXCEPTION 'Amended source scope is immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER invoice_amended_scope_guard BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_payment_term_source_scope_guard();
CREATE TRIGGER receipt_amended_scope_guard BEFORE UPDATE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION erp_payment_term_source_scope_guard();
ALTER TABLE "PaymentTermAmendment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PaymentTermAmendment" FROM PUBLIC;
REVOKE ALL ON FUNCTION erp_payment_term_actor_access(UUID,UUID,UUID,UUID,TEXT),erp_payment_term_amendment_guard(),erp_payment_term_amendment_audit(),erp_payment_term_source_scope_guard() FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
  EXECUTE format('REVOKE ALL ON "PaymentTermAmendment" FROM %I',role_name);
  EXECUTE format('REVOKE ALL ON FUNCTION erp_payment_term_actor_access(UUID,UUID,UUID,UUID,TEXT),erp_payment_term_amendment_guard(),erp_payment_term_amendment_audit(),erp_payment_term_source_scope_guard() FROM %I',role_name);
 END IF;END LOOP;END $$;
INSERT INTO "Permission"(key) VALUES('invoice-payment-term:manage'),('receipt-payment-term:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission"("tenantId","roleId","permissionKey") SELECT "tenantId",id,p.key FROM "Role" CROSS JOIN (VALUES('invoice-payment-term:manage'),('receipt-payment-term:manage')) p(key) WHERE name='Owner' ON CONFLICT DO NOTHING;
