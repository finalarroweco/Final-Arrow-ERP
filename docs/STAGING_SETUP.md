# Persistent staging database and live application

Database and hosting activation are complete (2026-10-05). The live review URL is https://final-arrow-erp.vercel.app/dashboard. The available connected Supabase organization is `Final Arrow Health`; its existing Health and NAYROQ projects are unrelated to ERP. The separate `Final Arrow ERP` project is provisioned. The Neon connector currently requires a known project ID and does not expose project discovery/creation.

## Connection and migration setup

1. Use a dedicated ERP PostgreSQL database. Keep `DATABASE_URL` and `DIRECT_DATABASE_URL` in the hosting secret store and an ignored local environment file; never commit credentials. `DATABASE_URL` is the application connection, and `DIRECT_DATABASE_URL` is the direct migration connection. On local PostgreSQL they can be identical. For a managed provider, copy both from its console and require TLS.
2. Run `npm ci`, `npm run db:deploy`, then `npm run db:status`. Deploy the committed migration history; do not use `db push` or copy raw tables. CI already validates all migrations against an isolated PostgreSQL 16 service.
3. Deploy the repository as a Node.js Next.js application with `npm run build` and `npm run start`, using Node.js 24 as in CI. Vercel hosts the application from `feature/core-auth-companies-branches`.
4. Use a private HTTPS staging URL for initial setup. Temporarily enable `ALLOW_REGISTRATION=true`, register the first Owner through the application, then set it back to `false`. Password hashing runs before the short registration transaction; role permissions are inserted in batches to avoid remote-database round trips. Never write a reusable default administrator password into the repository.
5. Create a fictional organization with two companies and branches. Verify Owner/Manager/Viewer permissions, invitations, quote → order → invoice, purchase → receipt → stock, HR, project time, payroll, POS/kitchen, reports and ledger period locks.
6. Keep CI's synthetic API/database fixture tests on an isolated test database. They insert and remove their own fixtures and must not be run against the persistent staging database or production data.

The application retains its own authentication and scoped access controls. PostgreSQL is used on the server through Prisma; do not expose its credentials to clients. If Supabase is chosen, keep ERP tables in a private schema or disable Data API exposure; do not grant anonymous or Supabase-authenticated access to ERP data. Supabase Auth is not used by this application.

The latest HTML walkthrough is `/erp-preview-v6.html`, using sample records only. It is separate from the authenticated application. Account email verification/recovery, payment integrations and regulatory accounting remain unfinished; see `RELEASE_STATUS.md` for module limits.

## Database provisioned — 2026-10-05

Supabase project `Final Arrow ERP` (`uqgsvbfmgnorepdydyde`) is in the authorized Final Arrow Health organization, Mumbai (`ap-south-1`), Micro compute. The user approved the displayed additional $10/month compute cost. Data API and automatic table exposure were disabled during creation.

All 31 Prisma migrations were applied through GitHub Actions using the write-only `ERP_DATABASE_URL` repository secret. `prisma migrate status` passed. The database has 47 public tables including Prisma migration history, no unfinished migrations, and no initial users. The temporary automatic bootstrap job was removed after success. The helper script checks the exact project/session pooler endpoint and enforces TLS without printing credentials.

Vercel hosting and server-side connection variables are configured. The owner account and Final Arrow / FA01 company (OMR) exist. Registration is now disabled. All deployments require Vercel team authentication. Runtime Prisma switches the Supabase session endpoint to transaction port 6543 on Vercel with pgbouncer and TLS; migration connections remain separate.

Provider access hardening was applied separately as Supabase migration `erp_private_database_access`: revoke public-table/sequence access from anon/authenticated, remove public/API function execution grants, revoke corresponding postgres default privileges, and pin the five ERP trigger functions to `public, pg_temp`. This is provider access configuration, not a replacement for Prisma schema migrations. After hardening the API-role table grant count is zero and the security advisor is clear.
