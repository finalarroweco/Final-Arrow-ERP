ALTER TABLE "PosRefund" ADD COLUMN kind VARCHAR(10) NOT NULL DEFAULT 'FULL' CHECK(kind IN('FULL','PARTIAL'));
CREATE TABLE "PosRefundLine" (
 "refundId" UUID NOT NULL REFERENCES "PosRefund"(id) ON DELETE RESTRICT,"orderLineId" UUID NOT NULL REFERENCES "PosOrderLine"(id) ON DELETE RESTRICT,
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),"netAmount" NUMERIC(18,3) NOT NULL CHECK("netAmount">0),"taxAmount" NUMERIC(18,3) NOT NULL CHECK("taxAmount">=0),
 PRIMARY KEY("refundId","orderLineId")
);
CREATE INDEX "PosRefundLine_orderLineId_idx" ON "PosRefundLine"("orderLineId");
DROP TRIGGER pos_refund_validate ON "PosRefund";
CREATE OR REPLACE FUNCTION erp_validate_pos_refund() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE o "PosOrder"%ROWTYPE; original "JournalEntry"%ROWTYPE; j "JournalEntry"%ROWTYPE; tax NUMERIC; latest DATE; detail RECORD; sold RECORD; used_qty INTEGER; used_tax NUMERIC; saved_tax NUMERIC; expected_tax NUMERIC; sum_net NUMERIC:=0;sum_tax NUMERIC:=0;
BEGIN
 SELECT * INTO o FROM "PosOrder" WHERE id=NEW."orderId" FOR UPDATE;
 SELECT * INTO original FROM "JournalEntry" WHERE id=NEW."originalEntryId";
 SELECT * INTO j FROM "JournalEntry" WHERE id=NEW."entryId";
 SELECT COALESCE((SELECT "taxAmount" FROM "PosVat" WHERE "orderId"=o.id),0) INTO tax;
 IF o.id IS NULL OR o.status<>'PAID' OR original.id IS NULL OR j.id IS NULL OR original.number<>erp_purchase_document_number('SYSP',o.id) OR original."reversalOf" IS NOT NULL OR EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reversalOf"=original.id) OR ROW(NEW."tenantId",NEW."companyId") IS DISTINCT FROM ROW(o."tenantId",o."companyId") OR ROW(original."tenantId",original."companyId",original."branchId",original.currency,original.total) IS DISTINCT FROM ROW(o."tenantId",o."companyId",o."branchId",o.currency,o.total) OR ROW(j."tenantId",j."companyId",j."branchId",j.currency,j.total,j."createdBy") IS DISTINCT FROM ROW(o."tenantId",o."companyId",o."branchId",o.currency,NEW.amount,NEW."createdBy") OR j.number<>erp_purchase_document_number('SYSU',NEW.id) OR j."reversalOf" IS NOT NULL OR j."creationTransaction"<>txid_current()::text THEN RAISE EXCEPTION 'Refund requires original paid POS journal and same-transaction scoped snapshot' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM "PosRefund" f WHERE f."orderId"=o.id AND f.id<>NEW.id AND (NEW.kind='FULL' OR f.kind='FULL') AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=f."entryId")) THEN RAISE EXCEPTION 'Full refund conflicts with active refund history' USING ERRCODE='23514';END IF;
 SELECT max(d) INTO latest FROM (SELECT original."entryDate" d UNION ALL SELECT o."paidAt"::date UNION ALL SELECT COALESCE(r."entryDate",e."entryDate") FROM "PosRefund" f JOIN "JournalEntry" e ON e.id=f."entryId" LEFT JOIN "JournalEntry" r ON r."reversalOf"=e.id WHERE f."orderId"=o.id AND f.id<>NEW.id) dates;
 IF j."entryDate"<latest THEN RAISE EXCEPTION 'Refund precedes later activity' USING ERRCODE='23514';END IF;
 IF NEW.kind='FULL' THEN
 IF NEW.amount<>o.total OR NEW."netAmount"<>o.total-tax OR NEW."taxAmount"<>tax OR EXISTS(SELECT 1 FROM "PosRefundLine" WHERE "refundId"=NEW.id) OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=j.id)<>(SELECT count(*) FROM "JournalLine" WHERE "entryId"=original.id) OR EXISTS(SELECT 1 FROM "JournalLine" old_line LEFT JOIN "JournalLine" refund_line ON refund_line."entryId"=j.id AND refund_line.position=old_line.position WHERE old_line."entryId"=original.id AND (refund_line.id IS NULL OR ROW(refund_line."accountId",refund_line.debit,refund_line.credit) IS DISTINCT FROM ROW(old_line."accountId",old_line.credit,old_line.debit))) THEN RAISE EXCEPTION 'Refund must retain original accounts, exact opposite amounts and latest activity date' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "PosRefundLine" WHERE "refundId"=NEW.id) THEN RAISE EXCEPTION 'Partial refund requires saved original lines' USING ERRCODE='23514';END IF;
  FOR detail IN SELECT * FROM "PosRefundLine" WHERE "refundId"=NEW.id LOOP
   SELECT * INTO sold FROM "PosOrderLine" WHERE id=detail."orderLineId" AND "orderId"=o.id;
   IF sold.id IS NULL THEN RAISE EXCEPTION 'Refund line belongs to a different order' USING ERRCODE='23514';END IF;
   SELECT COALESCE(sum(l.quantity),0),COALESCE(sum(l."taxAmount"),0) INTO used_qty,used_tax FROM "PosRefundLine" l JOIN "PosRefund" f ON f.id=l."refundId" WHERE l."orderLineId"=sold.id AND f.id<>NEW.id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" r WHERE r."reversalOf"=f."entryId");
   SELECT COALESCE((SELECT (d->>'tax')::numeric FROM "PosVat" v CROSS JOIN LATERAL jsonb_array_elements(v.details) d WHERE v."orderId"=o.id AND (d->>'position')::integer=sold.position),0) INTO saved_tax;
   IF used_qty+detail.quantity>sold.quantity OR used_tax>saved_tax THEN RAISE EXCEPTION 'Refund exceeds remaining quantity or VAT' USING ERRCODE='23514';END IF;
   expected_tax:=round((saved_tax-used_tax)*detail.quantity/(sold.quantity-used_qty),3);
   IF detail."netAmount"<>sold."unitPrice"*detail.quantity OR detail."taxAmount"<>expected_tax THEN RAISE EXCEPTION 'Partial refund must allocate saved remaining VAT exactly' USING ERRCODE='23514';END IF;
   sum_net:=sum_net+detail."netAmount";sum_tax:=sum_tax+detail."taxAmount";
  END LOOP;
  IF NEW."netAmount"<>sum_net OR NEW."taxAmount"<>sum_tax OR NEW.amount<>sum_net+sum_tax OR (SELECT count(*) FROM "JournalLine" WHERE "entryId"=j.id)<>(CASE WHEN sum_tax>0 THEN 3 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "JournalLine" src ON src."entryId"=original.id AND src.position=0 WHERE l."entryId"=j.id AND l.position=0 AND l."accountId"=src."accountId" AND l.debit=0 AND l.credit=NEW.amount) OR NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "JournalLine" src ON src."entryId"=original.id AND src.position=1 WHERE l."entryId"=j.id AND l.position=1 AND l."accountId"=src."accountId" AND l.credit=0 AND l.debit=sum_net) OR (sum_tax>0 AND NOT EXISTS(SELECT 1 FROM "JournalLine" l JOIN "JournalLine" src ON src."entryId"=original.id AND src.position=2 WHERE l."entryId"=j.id AND l.position=2 AND l."accountId"=src."accountId" AND l.credit=0 AND l.debit=sum_tax)) THEN RAISE EXCEPTION 'Partial refund journal totals or original accounts mismatch' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_refund_validate AFTER INSERT ON "PosRefund" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_validate_pos_refund();
CREATE FUNCTION erp_pos_refund_line_original() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "PosRefund" f JOIN "JournalEntry" j ON j.id=f."entryId" JOIN "PosOrderLine" l ON l."orderId"=f."orderId" AND l.id=NEW."orderLineId" WHERE f.id=NEW."refundId" AND f.kind='PARTIAL' AND j."creationTransaction"=txid_current()::text) THEN RAISE EXCEPTION 'Refund lines require original transaction and original order' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_refund_line_original BEFORE INSERT ON "PosRefundLine" FOR EACH ROW EXECUTE FUNCTION erp_pos_refund_line_original();
CREATE TRIGGER pos_refund_line_immutable BEFORE UPDATE OR DELETE ON "PosRefundLine" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
ALTER TABLE "PosRefundLine" ENABLE ROW LEVEL SECURITY;
DO $$BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PosRefundLine" FROM anon;END IF;IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PosRefundLine" FROM authenticated;END IF;END$$;
REVOKE EXECUTE ON FUNCTION erp_pos_refund_line_original() FROM PUBLIC;
