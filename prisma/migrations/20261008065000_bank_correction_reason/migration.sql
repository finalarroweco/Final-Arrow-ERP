-- PostgreSQL CHECK accepts NULL; require explicit reasons for each correction.
ALTER TABLE "BankStatement" ADD CONSTRAINT bank_statement_void_reason_required CHECK ("voidedAt" IS NULL OR ("voidReason" IS NOT NULL AND length(trim("voidReason")) BETWEEN 3 AND 300));
ALTER TABLE "BankMatch" ADD CONSTRAINT bank_match_cancel_reason_required CHECK ("cancelledAt" IS NULL OR ("cancelReason" IS NOT NULL AND length(trim("cancelReason")) BETWEEN 3 AND 300));
