CREATE TABLE "LoginThrottle" (
 "keyHash" VARCHAR(64) NOT NULL PRIMARY KEY,
 "attempts" INTEGER NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LoginThrottle_attempts_check" CHECK ("attempts" BETWEEN 1 AND 6),
 CONSTRAINT "LoginThrottle_key_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "LoginThrottle_expiresAt_idx" ON "LoginThrottle"("expiresAt");
