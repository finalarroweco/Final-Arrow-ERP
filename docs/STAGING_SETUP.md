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

## Verified schema updates — 2026-10-06
The backward-compatible partial-receipt migration is applied as the 32nd Prisma migration. Existing receipts and quantities are preserved. `Core checks` now applies committed migrations to the dedicated ERP project only after isolated checks pass, only for the same-repository `feature/core-auth-companies-branches` pull request. The project-bound helper uses the existing write-only secret and never logs connection details. It runs migration deploy and status; fixture tests remain isolated.


Goods stock returns are available at `/purchasing/returns`. Create them from a saved receipt; no synthetic fixtures should be entered into production. Migration `20261007110000_goods_returns` was deployed before the app update. Supplier financial credits/refunds and stock valuation are not included in the stock-return document.

Receipt accruals and purchase-return credit journals can be posted from their document pages. Set up purchase asset/expense and supplier liability accounts first. Return journals require the active receipt journal and use its same accounts. Registers show financial status only within ledger-read scope. Supplier cash settlements and tax adjustments are not performed by these actions.

Receipt-linked supplier settlements are available at `/purchasing/settlements` and from each authorized receipt document. Post its accrual first, then record an actual payment using a company cash/bank asset account. A posted return credit can create a refundable balance. Payments/refunds update supplier statements and balances and support journal corrections. No bank transfer is initiated. Apply all 34 migrations before deploying this application revision.

Organization owners can use `/settings/roles` to create operational role templates and replace a member's role/scope assignments. The workspace invitation form offers saved custom roles. Changes affect all members using the role and are audited; owner administration remains protected. Use isolated test members for access review and do not assign broader live permissions as a test.

### Customer collection checks (2026-10-08)

Open Accounting → Invoices, issue and post a test invoice to a receivable asset / revenue account, then select Collections / refunds. Use a separate cash/bank asset and the actual movement reference. Check balance before saving. The form preserves an unconfirmed request in the current browser tab for exact retry after a network failure. Collection records and journals remain immutable; use journal reversal to correct them, with dependent refunds corrected before collections when required. Never insert test financial movements in the live ERP.

Review `/accounting/collections` and `/accounting/customer-statement` with a company/branch-scoped user. Statements are based on posted source journals, include recorded invoice VAT and exclude unrelated manual entries, and show each currency separately. Print the internal invoice to verify net collected and outstanding amounts. The isolated CI database exercises these actions automatically.

### Oman invoice VAT checks (2026-10-08)

The 42nd migration adds opt-in company VAT profiles and immutable internal invoice VAT snapshots. Core checks #138 passed all 42 migrations, six unit checks, two database checks, build and eleven isolated API flows. No live registration was configured and no synthetic financial records were created. The authenticated Arabic VAT settings and invoice pages loaded successfully.

Use `/accounting/vat-settings` only with actual registration data and a company output VAT liability account. Prices exclude VAT. Standard, zero-rated and exempt treatments are explicit per invoice line; per-line rounding uses three decimals, half up. Internal invoice posting credits net revenue plus recorded output VAT and debits the gross customer receivable. Collections/refunds and customer statements use gross values. Purchase/expense/POS VAT and statutory electronic invoices remain outside this slice.
