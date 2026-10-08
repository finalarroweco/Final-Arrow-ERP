ALTER TABLE "Company" ADD COLUMN "ledgerLockedThrough" DATE;

-- A shared company row lock serializes journal insertion with period changes.
-- Held until commit, it also prevents a period from closing midway through posting.
CREATE FUNCTION enforce_journal_open_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked_through DATE;
BEGIN
  SELECT "ledgerLockedThrough" INTO locked_through FROM "Company"
    WHERE "tenantId" = NEW."tenantId" AND "id" = NEW."companyId" FOR SHARE;
  IF locked_through IS NOT NULL AND NEW."entryDate" <= locked_through THEN
    RAISE EXCEPTION 'Journal date falls within a closed ledger period' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_open_period BEFORE INSERT ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION enforce_journal_open_period();

INSERT INTO "Permission" ("key") VALUES ('ledger-period:manage') ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionKey")
  SELECT "tenantId", "id", 'ledger-period:manage' FROM "Role" WHERE "name" = 'Owner'
  ON CONFLICT ("tenantId", "roleId", "permissionKey") DO NOTHING;
