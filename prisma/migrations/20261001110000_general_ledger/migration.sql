-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "entryDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "total" DECIMAL(18,3) NOT NULL,
    "reversalOf" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "debit" DECIMAL(18,3) NOT NULL,
    "credit" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_tenantId_companyId_id_key" ON "LedgerAccount"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOf_key" ON "JournalEntry"("reversalOf");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_companyId_branchId_entryDate_idx" ON "JournalEntry"("tenantId", "companyId", "branchId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_companyId_id_key" ON "JournalEntry"("tenantId", "companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_companyId_reversalOf_key" ON "JournalEntry"("tenantId", "companyId", "reversalOf");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_companyId_number_key" ON "JournalEntry"("companyId", "number");

-- CreateIndex
CREATE INDEX "JournalLine_tenantId_companyId_accountId_idx" ON "JournalLine"("tenantId", "companyId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalLine_entryId_position_key" ON "JournalLine"("entryId", "position");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_companyId_reversalOf_fkey" FOREIGN KEY ("tenantId", "companyId", "reversalOf") REFERENCES "JournalEntry"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_companyId_branchId_fkey" FOREIGN KEY ("tenantId", "companyId", "branchId") REFERENCES "Branch"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_tenantId_companyId_entryId_fkey" FOREIGN KEY ("tenantId", "companyId", "entryId") REFERENCES "JournalEntry"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_tenantId_companyId_accountId_fkey" FOREIGN KEY ("tenantId", "companyId", "accountId") REFERENCES "LedgerAccount"("tenantId", "companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_total_check" CHECK ("total" > 0);
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amount_check" CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));
-- Deferred verification permits inserting a header and all lines in one transaction.
CREATE FUNCTION verify_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; expected NUMERIC; dr NUMERIC; cr NUMERIC; line_count BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'JournalEntry' THEN target := NEW."id"; ELSE target := NEW."entryId"; END IF;
  SELECT "total" INTO expected FROM "JournalEntry" WHERE "id" = target;
  SELECT COALESCE(SUM("debit"),0), COALESCE(SUM("credit"),0), COUNT(*) INTO dr, cr, line_count FROM "JournalLine" WHERE "entryId" = target;
  IF line_count < 2 OR dr <> cr OR dr <> expected THEN RAISE EXCEPTION 'Journal must have at least two balanced lines matching its total' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_header_balance AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_journal_balance();
CREATE CONSTRAINT TRIGGER journal_line_balance AFTER INSERT ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_journal_balance();
CREATE FUNCTION prevent_journal_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Posted journals are immutable; create a reversal' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER immutable_journal BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
CREATE TRIGGER immutable_journal_line BEFORE UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION prevent_journal_changes();
INSERT INTO "Permission" ("key") VALUES ('ledger:read'), ('ledger:post'), ('ledger-account:manage') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey") SELECT role."tenantId", role."id", permissions.key FROM "Role" role
CROSS JOIN (VALUES ('ledger:read'), ('ledger:post'), ('ledger-account:manage')) permissions(key)
WHERE role."name" = 'Owner' OR (role."name" = 'Manager' AND permissions.key IN ('ledger:read', 'ledger:post'))
ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
