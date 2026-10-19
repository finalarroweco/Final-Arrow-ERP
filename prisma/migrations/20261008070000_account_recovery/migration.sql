CREATE TABLE "RecoveryCode" (
 "id" UUID NOT NULL PRIMARY KEY,"userId" UUID NOT NULL,"codeHash" VARCHAR(64) NOT NULL UNIQUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT recovery_code_hash_shape CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE
);
CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");
ALTER TABLE "RecoveryCode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RecoveryCode" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "RecoveryCode" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "RecoveryCode" FROM authenticated; END IF;
END $$;
