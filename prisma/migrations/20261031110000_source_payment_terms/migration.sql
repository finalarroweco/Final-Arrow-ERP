-- Explicit contractual dates; legacy documents deliberately remain undated.
ALTER TABLE "Invoice" ADD COLUMN "paymentTerms" VARCHAR(120), ADD COLUMN "paymentDueDate" DATE;
ALTER TABLE "GoodsReceipt" ADD COLUMN "paymentTerms" VARCHAR(120), ADD COLUMN "paymentDueDate" DATE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payment_terms_check" CHECK (("paymentTerms" IS NULL AND "paymentDueDate" IS NULL) OR ("paymentTerms" IS NOT NULL AND length(trim("paymentTerms")) BETWEEN 3 AND 120 AND "paymentDueDate" IS NOT NULL AND "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'));
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_payment_terms_check" CHECK (("paymentTerms" IS NULL AND "paymentDueDate" IS NULL) OR ("paymentTerms" IS NOT NULL AND length(trim("paymentTerms")) BETWEEN 3 AND 120 AND "paymentDueDate" IS NOT NULL AND "paymentDueDate" BETWEEN DATE '2000-01-01' AND DATE '2099-12-31'));
CREATE FUNCTION erp_guard_source_payment_terms() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."paymentTerms" IS DISTINCT FROM OLD."paymentTerms" OR NEW."paymentDueDate" IS DISTINCT FROM OLD."paymentDueDate" THEN
 RAISE EXCEPTION 'Original contractual payment terms are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_payment_terms_immutable BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION erp_guard_source_payment_terms();
CREATE TRIGGER receipt_payment_terms_immutable BEFORE UPDATE ON "GoodsReceipt" FOR EACH ROW EXECUTE FUNCTION erp_guard_source_payment_terms();
REVOKE ALL ON FUNCTION erp_guard_source_payment_terms() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON FUNCTION erp_guard_source_payment_terms() FROM anon'; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE 'REVOKE ALL ON FUNCTION erp_guard_source_payment_terms() FROM authenticated'; END IF;
END $$;
