import {createHash} from "node:crypto";
import {db} from "./db";
// Reserve an attempt before password verification; the upsert serializes concurrent workers.
export async function reserveLoginAttempt(email:string,purpose:"login"|"password"|"recovery"|"recovery-setup"="login"){
 const keyHash=createHash("sha256").update(`${purpose}:${email.trim().toLowerCase()}`).digest("hex");
 const [bucket]=await db.$queryRaw<{attempts:number;expiresAt:Date;stamp:Date}[]>`
 INSERT INTO "LoginThrottle" ("keyHash","attempts","expiresAt")
 VALUES (${keyHash},1,statement_timestamp()+interval '15 minutes')
 ON CONFLICT ("keyHash") DO UPDATE SET
 "attempts"=CASE WHEN "LoginThrottle"."expiresAt"<=statement_timestamp() THEN 1 ELSE LEAST("LoginThrottle"."attempts"+1,6) END,
 "expiresAt"=CASE WHEN "LoginThrottle"."expiresAt"<=statement_timestamp() THEN statement_timestamp()+interval '15 minutes' ELSE "LoginThrottle"."expiresAt" END
 RETURNING "attempts","expiresAt",statement_timestamp() AS stamp`;
 // Bounded maintenance; never delete the current active bucket.
 await db.$executeRaw`DELETE FROM "LoginThrottle" WHERE "keyHash" IN (SELECT "keyHash" FROM "LoginThrottle" WHERE "expiresAt"<statement_timestamp()-interval '1 day' ORDER BY "expiresAt" LIMIT 100)`;
 return {allowed:bucket.attempts<=5,retryAfter:Math.max(1,Math.ceil((bucket.expiresAt.getTime()-bucket.stamp.getTime())/1000))};
}
