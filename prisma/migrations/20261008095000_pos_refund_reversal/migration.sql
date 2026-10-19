CREATE INDEX "PosRefund_orderId_idx" ON "PosRefund"("orderId");
CREATE INDEX "PosRefund_originalEntryId_idx" ON "PosRefund"("originalEntryId");
CREATE FUNCTION erp_verify_pos_reversal_lines() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE original "JournalEntry"%ROWTYPE;
BEGIN
 IF NEW."reversalOf" IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO original FROM "JournalEntry" WHERE id=NEW."reversalOf";
 IF original.number !~ '^SYS[PU]-' THEN RETURN NULL;END IF;
 IF original."reversalOf" IS NOT NULL OR ROW(NEW."tenantId",NEW."companyId",NEW."branchId",NEW.currency,NEW.total) IS DISTINCT FROM ROW(original."tenantId",original."companyId",original."branchId",original.currency,original.total) OR NEW."entryDate"<original."entryDate" OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=NEW.id)<>(SELECT count(*) FROM "JournalLine" WHERE "entryId"=original.id) OR EXISTS(SELECT 1 FROM "JournalLine" old_line LEFT JOIN "JournalLine" correction_line ON correction_line."entryId"=NEW.id AND correction_line.position=old_line.position WHERE old_line."entryId"=original.id AND (correction_line.id IS NULL OR ROW(correction_line."accountId",correction_line.debit,correction_line.credit) IS DISTINCT FROM ROW(old_line."accountId",old_line.credit,old_line.debit))) OR NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a."actorId"=NEW."createdBy" AND a.entity='JournalEntry' AND a."entityId"=original.id::text AND a.action='journal.reversed' AND a.metadata->>'reversalId'=NEW.id::text) THEN RAISE EXCEPTION 'POS sale/refund corrections require exact original amounts, accounts and audit' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_reversal_exact_lines AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_verify_pos_reversal_lines();
REVOKE EXECUTE ON FUNCTION erp_verify_pos_reversal_lines() FROM PUBLIC;
