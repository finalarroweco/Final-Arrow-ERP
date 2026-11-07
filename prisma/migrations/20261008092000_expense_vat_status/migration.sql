CREATE FUNCTION erp_preserve_expense_vat_status() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status AND EXISTS(SELECT 1 FROM "ExpenseVat" v WHERE v."expenseId"=OLD.id) AND (NEW.status<>'VOID' OR EXISTS(SELECT 1 FROM "ExpenseVat" v JOIN "JournalEntry" j ON j.id=v."entryId" WHERE v."expenseId"=OLD.id AND NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reversalOf"=j.id))) THEN RAISE EXCEPTION 'Reverse expense VAT journal before voiding; posted history cannot reopen' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER expense_vat_status_preserve BEFORE UPDATE OF status ON "Expense" FOR EACH ROW EXECUTE FUNCTION erp_preserve_expense_vat_status();
REVOKE EXECUTE ON FUNCTION erp_preserve_expense_vat_status() FROM PUBLIC;
