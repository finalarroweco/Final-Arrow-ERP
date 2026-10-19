CREATE FUNCTION erp_purchase_document_number(prefix TEXT, source_id UUID) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
DECLARE n NUMERIC:=0; hex TEXT:=replace(source_id::text,'-',''); result TEXT:=''; i INTEGER; digit INTEGER;
BEGIN
 FOR i IN 1..32 LOOP n:=n*16+strpos('0123456789abcdef',substring(hex,i,1))-1;END LOOP;
 WHILE n>0 LOOP digit:=mod(n,36)::integer;result:=substring('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',digit+1,1)||result;n:=trunc(n/36);END LOOP;
 RETURN prefix||'-'||lpad(result,25,'0');
END $$;
CREATE FUNCTION erp_purchase_vat_source_link() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE id=NEW."entryId" AND number=erp_purchase_document_number(CASE WHEN NEW."returnId" IS NULL THEN 'SYSG' ELSE 'SYST' END,COALESCE(NEW."returnId",NEW."receiptId"))) THEN RAISE EXCEPTION 'Purchase VAT source number mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_vat_number BEFORE INSERT ON "PurchaseVat" FOR EACH ROW EXECUTE FUNCTION erp_purchase_vat_source_link();
CREATE FUNCTION erp_purchase_journal_source_required() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.number !~ '^SYS[GT]-' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditLog" a WHERE a."tenantId"=NEW."tenantId" AND a.metadata->>'journalId'=NEW.id::text AND
  ((a.entity='GoodsReceipt' AND a.action='purchase-receipt.ledger_posted' AND NEW.number=erp_purchase_document_number('SYSG',a."entityId"::uuid)) OR (a.entity='GoodsReturn' AND a.action='purchase-return.ledger_posted' AND NEW.number=erp_purchase_document_number('SYST',a."entityId"::uuid)))) THEN RAISE EXCEPTION 'Purchase journal requires a matching source audit' USING ERRCODE='23514';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER purchase_journal_source_required AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_purchase_journal_source_required();
REVOKE EXECUTE ON FUNCTION erp_purchase_document_number(TEXT,UUID),erp_purchase_vat_source_link(),erp_purchase_journal_source_required() FROM PUBLIC;
