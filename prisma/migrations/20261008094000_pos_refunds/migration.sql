CREATE TABLE "PosRefund" (
 id UUID PRIMARY KEY,"tenantId" UUID NOT NULL,"companyId" UUID NOT NULL,"orderId" UUID NOT NULL,"entryId" UUID NOT NULL UNIQUE,"originalEntryId" UUID NOT NULL,
 "netAmount" NUMERIC(18,3) NOT NULL CHECK("netAmount">0),"taxAmount" NUMERIC(18,3) NOT NULL CHECK("taxAmount">=0),amount NUMERIC(18,3) NOT NULL CHECK(amount="netAmount"+"taxAmount"),
 reference VARCHAR(120) NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 120),reason VARCHAR(500) NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),"createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY("tenantId","companyId","orderId") REFERENCES "PosOrder"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","entryId") REFERENCES "JournalEntry"("tenantId","companyId",id) ON DELETE RESTRICT,
 FOREIGN KEY("tenantId","companyId","originalEntryId") REFERENCES "JournalEntry"("tenantId","companyId",id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "PosRefund_tenantId_companyId_entryId_key" ON "PosRefund"("tenantId","companyId","entryId");
CREATE INDEX "PosRefund_tenantId_companyId_orderId_idx" ON "PosRefund"("tenantId","companyId","orderId");
CREATE FUNCTION erp_validate_pos_refund() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o "PosOrder"%ROWTYPE; original "JournalEntry"%ROWTYPE; j "JournalEntry"%ROWTYPE; tax NUMERIC; latest DATE;
BEGIN
 SELECT * INTO o FROM "PosOrder" WHERE id=NEW."orderId" FOR UPDATE;
 SELECT * INTO original FROM "JournalEntry" WHERE id=NEW."originalEntryId";
 SELECT * INTO j FROM "JournalEntry" WHERE id=NEW."entryId";
 SELECT COALESCE((SELECT "taxAmount" FROM "PosVat" WHERE "orderId"=o.id),0) INTO tax;
 IF o.id IS NULL OR o.status<>'PAID' OR original.id IS NULL OR j.id IS NULL OR original.number<>erp_purchase_document_number('SYSP',o.id) OR original."reversalOf" IS NOT NULL OR EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reversalOf"=original.id) OR ROW(NEW."tenantId",NEW."companyId",NEW.amount,NEW."netAmount",NEW."taxAmount") IS DISTINCT FROM ROW(o."tenantId",o."companyId",o.total,o.total-tax,tax) OR ROW(original."tenantId",original."companyId",original."branchId",original.currency,original.total) IS DISTINCT FROM ROW(o."tenantId",o."companyId",o."branchId",o.currency,o.total) OR ROW(j."tenantId",j."companyId",j."branchId",j.currency,j.total,j."createdBy") IS DISTINCT FROM ROW(o."tenantId",o."companyId",o."branchId",o.currency,o.total,NEW."createdBy") OR j.number<>erp_purchase_document_number('SYSU',NEW.id) OR j."reversalOf" IS NOT NULL OR j."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Full refund requires original paid POS journal and same-transaction scoped snapshot' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM "PosRefund" f WHERE f."orderId"=o.id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=f."entryId")) THEN RAISE EXCEPTION 'POS order already has an active full refund' USING ERRCODE='23514';END IF;
 SELECT max(d) INTO latest FROM (SELECT original."entryDate" d UNION ALL SELECT o."paidAt"::date UNION ALL SELECT COALESCE(r."entryDate",e."entryDate") FROM "PosRefund" f JOIN "JournalEntry" e ON e.id=f."entryId" LEFT JOIN "JournalEntry" r ON r."reversalOf"=e.id WHERE f."orderId"=o.id) dates;
 IF j."entryDate"<latest OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=j.id)<>(SELECT count(*) FROM "JournalLine" WHERE "entryId"=original.id) OR EXISTS(SELECT 1 FROM "JournalLine" old_line LEFT JOIN "JournalLine" refund_line ON refund_line."entryId"=j.id AND refund_line.position=old_line.position WHERE old_line."entryId"=original.id AND (refund_line.id IS NULL OR ROW(refund_line."accountId",refund_line.debit,refund_line.credit) IS DISTINCT FROM ROW(old_line."accountId",old_line.credit,old_line.debit))) THEN RAISE EXCEPTION 'Refund must retain original accounts, exact opposite amounts and latest activity date' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_refund_validate BEFORE INSERT ON "PosRefund" FOR EACH ROW EXECUTE FUNCTION erp_validate_pos_refund();
CREATE TRIGGER pos_refund_immutable BEFORE UPDATE OR DELETE ON "PosRefund" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE FUNCTION erp_require_pos_refund_source() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.number ~ '^SYSU-' AND NOT EXISTS(SELECT 1 FROM "PosRefund" f JOIN "AuditLog" a ON a."tenantId"=f."tenantId" AND a.entity='PosRefund' AND a."entityId"=f.id::text AND a.action='pos-refund.recorded' AND a.metadata->>'journalId'=NEW.id::text WHERE f."entryId"=NEW.id AND NEW.number=erp_purchase_document_number('SYSU',f.id)) THEN RAISE EXCEPTION 'POS refund journal requires immutable source and audit' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_refund_source_required AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_require_pos_refund_source();
CREATE FUNCTION erp_pos_refund_reversal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE source_number TEXT;order_id UUID;latest DATE;
BEGIN
 IF NEW."reversalOf" IS NULL THEN RETURN NEW;END IF;
 SELECT j.number INTO source_number FROM "JournalEntry" j WHERE j.id=NEW."reversalOf";
 IF source_number ~ '^SYSU-' THEN SELECT "orderId" INTO order_id FROM "PosRefund" WHERE "entryId"=NEW."reversalOf";
 ELSIF source_number ~ '^SYSP-' THEN SELECT id INTO order_id FROM "PosOrder" WHERE erp_purchase_document_number('SYSP',id)=source_number AND "tenantId"=NEW."tenantId" AND "companyId"=NEW."companyId";
 ELSE RETURN NEW;END IF;
 IF order_id IS NULL THEN RAISE EXCEPTION 'POS correction source missing' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM "PosOrder" WHERE id=order_id FOR UPDATE;
 SELECT max(d) INTO latest FROM (SELECT "paidAt"::date d FROM "PosOrder" WHERE id=order_id UNION ALL SELECT COALESCE(r."entryDate",j."entryDate") FROM "PosRefund" f JOIN "JournalEntry" j ON j.id=f."entryId" LEFT JOIN "JournalEntry" r ON r."reversalOf"=j.id WHERE f."orderId"=order_id) dates;
 IF NEW."entryDate"<latest THEN RAISE EXCEPTION 'POS correction cannot precede later refund activity' USING ERRCODE='23514';END IF;
 IF source_number ~ '^SYSP-' AND EXISTS(SELECT 1 FROM "PosRefund" f WHERE f."orderId"=order_id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=f."entryId")) THEN RAISE EXCEPTION 'Reverse active POS refund before original sale' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_refund_reversal_guard BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION erp_pos_refund_reversal_guard();
ALTER TABLE "PosRefund" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PosRefund" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PosRefund" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_validate_pos_refund(),erp_require_pos_refund_source(),erp_pos_refund_reversal_guard() FROM PUBLIC;
