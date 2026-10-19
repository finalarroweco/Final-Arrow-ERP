ALTER TABLE "BankStatement" ADD COLUMN "importTransaction" TEXT NOT NULL DEFAULT txid_current()::text;
CREATE OR REPLACE FUNCTION erp_validate_bank_line_insert() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "BankStatement" WHERE id=NEW."statementId" AND "importTransaction"=txid_current()::text) THEN RAISE EXCEPTION 'Bank statements cannot be extended after import' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION erp_validate_bank_line_insert() FROM PUBLIC;
