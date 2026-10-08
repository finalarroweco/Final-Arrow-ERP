import { PrismaClient } from "@prisma/client";

// Serverless instances must share database connections through transaction pooling.
// DIRECT_DATABASE_URL remains the session/direct connection used by Prisma migrations.
function runtimeDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw || process.env.VERCEL !== "1") return raw;
  const url = new URL(raw);
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    if (url.port === "5432") url.port = "6543";
    url.searchParams.set("pgbouncer", "true");
    url.searchParams.set("sslmode", "require");
  }
  url.searchParams.set("connection_limit", "1");
  return url.toString();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: runtimeDatabaseUrl() });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
