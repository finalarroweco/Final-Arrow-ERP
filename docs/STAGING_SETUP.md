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

Use `/accounting/vat-settings` only with actual registration data and a company output VAT liability account. Prices exclude VAT. Standard, zero-rated and exempt treatments are explicit per invoice line; per-line rounding uses three decimals, half up. Internal invoice posting credits net revenue plus recorded output VAT and debits the gross customer receivable. Collections/refunds and customer statements use gross values. Purchase, expense and POS VAT are described below; statutory electronic invoices remain outstanding.

### Purchase VAT checks (2026-10-08)

Apply all 47 migrations. Purchase VAT is classified when posting a receipt journal for a company whose VAT profile is enabled and effective on the receipt date. Select a scoped ASSET input-tax account for deductible tax; do not infer registration or claim deductibility without the actual supplier document. Every received line needs standard deductible/non-deductible, zero, exempt or no-tax classification. Supplier reference is required; standard tax requires supplier VAT number. Prices exclude VAT.

Verify mixed input VAT and gross supplier payments/refunds only in isolated fixtures, never by inserting production financial records. Return credit posting requires a supplier credit-note reference and retains original tax/account data. Successive and concurrent partial return postings allocate saved tax cumulatively; the last portion receives the exact rounding remainder. Reversal retains the VAT snapshot. Existing non-tax receipt journals remain unchanged. Expense and POS VAT are described below; reverse charge, imports, partial recovery percentages and statutory tax documents remain outside this slice.

### Expense VAT checks (2026-10-08)

Apply all 54 migrations. An expense amount is VAT-exclusive; active company VAT registration requires classification when its ledger journal is posted. Confirm the supplier invoice name/reference, standard supplier VAT number, treatment and deductibility using the actual document. Select a separate input VAT asset for deductible tax; non-deductible tax increases expense cost. An expense supports one classification; split legitimate source amounts explicitly if multiple treatments are needed. Do not infer eligibility or insert test financial records in production.

In isolated CI, verify gross cash/liability credit, net plus non-deductible expense debit and saved input VAT debit; then reverse the journal before voiding its source. Source-read plus ledger permissions are required. Changing the company input account must not change the reversal account or snapshot. Reports and dashboard sum expense cost; CSV separates net, tax, deductible tax and gross. Report statuses remain independent of journal reversal until the source is voided. This is not tax-return reporting or an expense payment/refund allocation system.

## POS VAT verification

Apply all 54 migrations before deploying the POS client. Confirm actual company registration through VAT settings only using supplied business data. For active OMR profiles, choose a treatment for every new order line; menu prices exclude VAT. Original seller, accounts, prices, treatment and rounding must remain unchanged after menu/profile edits. Cash tendered must cover gross and change uses gross. Card recording does not capture money.

Use isolated CI fixtures to verify gross asset/net revenue/output liability posting and reversal on the original saved accounts, exact two-line zero/exempt journals, source permissions and period locks. Internal receipts and paid-date CSV separate net/tax/gross. Journal reversal neither changes PAID status nor issues a refund; paid-order registers retain that order. Statutory tax documents, filing, shifts, inclusive prices, discounts, stock recipes and device capture remain separate work. Do not create production financial records for QA.

## Full POS refund recording and corrections

Apply all 54 migrations. From a paid order, post its original sale journal first, then open Full refund / history. Record only an actual completed full refund with a reference, reason and UTC journal date. Amounts and accounts come from the original order/journal; no new account/rate/amount is selected and no transfer, terminal refund or stock return is triggered. Partial refunds are described below.

Verify in isolated fixtures: exact gross/net/VAT opposite lines, two-line non-tax/zero cases, unchanged accounts after profile edits, same-UUID retries (including after reversal), different payload conflicts, concurrent different-ID exclusion, current-state refund totals/CSV, source/branch permissions, period locks and direct SQL guards. Correct an incorrect refund by reversing its journal before recording a genuine replacement. Reverse active refunds before reversing the original sale. Paid-date sales remain unchanged; the separate refund report uses UTC refund journal dates and current correction status, not as-of historical balances. Production QA uses read-only reports and creates no financial test records.

## Partial POS refund checks — 2026-10-16

Apply migration 54 before deploying the partial-refund client. In Refunds / history, select original line quantities up to their remaining quantities. Check the exact gross/net/VAT preview against the refund already performed, then supply the reference/reason and UTC date. Saved prices/tax and original cash/revenue/output accounts are retained. The last remaining portion receives exact saved tax residuals. This does not transfer money or restore stock.

Use only isolated CI to test out-of-order corrections, sub-mill tax rounding, racing last quantities, same-UUID reordered-line retries, changed-payload conflicts, full/partial overlap, foreign/late/wrong SQL lines, closed periods and exact total recovery. Correcting a record restores its saved quantities/tax, not a newly calculated tax amount. Old UUID retries always replay their original record, even after reversal. Production QA remains read-only; no synthetic sales/refunds or VAT configuration are created.

Unconfirmed full/partial requests use a versioned per-tab session-storage payload scoped to tenant/order, so refreshing the page can restore the same UUID and original lines. Invalid cache payloads are ignored. Definitive responses clear the request; uncertain failures retain it for exact retry. If browser tab storage is unavailable, the open component retains an in-memory retry only.


## Cash shifts — 2026-10-16

Apply all 56 migrations before using the cash-shift controls at /pos. Open a branch shift only with an actual counted opening float. One shared shift per branch is supported. Once shifts have been activated, an open shift is required for payments and refunds, including card records. Cash sales contribute the gross order amount, not total tendered; cash refunds subtract their saved gross amount. Card records have zero drawer effect.

Record only actual cash in/out with a reason/reference. Accounting journal reversals do not automatically move or restore cash in the drawer. Count the real cash at closure and explain any difference; closure is immutable, keeps its own exact snapshot and creates no ledger journal or bank transfer. Refunds of earlier sales belong to the current open shift. Stop before the 5000-event limit, count/close and open another shift as appropriate.

Use isolated CI to verify exact retries, scopes, cashier attribution, atomic source events, insufficient-cash rejection, signed variance, SQL lifecycle/audit guards and payment/close races. Live QA reads the initial shift status and history only; never create financial test records in production. Operational acceptance with the business's real cash-handling process is still required.


## Source balance aging — 2026-10-16

Open customer aging from the customer balance register or dashboard, and supplier aging from the supplier balance register or dashboard. Choose the company, original document branch, inclusive as-of journal date and optional party name/code. Age buckets use original posting date in UTC, never an assumed payment due date. Negative document credits stay separate; do not treat net party totals as allocations between sources. Details link to original invoice/receipt settlements. CSV contains summary and document row types; print styles support browser PDF.

No migration is required beyond the existing 56 migrations. Verify in isolated CI that collection/refund and purchase-return/payment corrections change the original document's open amount as of their posting dates without restarting its age. Production checks must remain read-only. Operational acceptance against actual customer/supplier control-account records and payment terms remains required.


## Contacts and internal follow-up — 2026-10-16

Apply all 57 migrations before using the new source links. Open Contacts on a CRM customer; customer read is needed to view, and customer update plus read to manage. Archive the contact rather than deleting it. Restore the customer/contact before edits. Edits require the currently displayed version. Contact records are not login accounts and do not send messages.

Open Internal follow-up on a helpdesk ticket; ticket read is needed to view, and ticket manage plus read to append. Notes are permanent internal records, not outbound customer conversations. Correct mistakes with a new note. Closed tickets are read-only. Both creation flows preserve ambiguous requests per tab for exact retry; if tab storage is unavailable, retry persistence is limited to the mounted component. Do not create demonstration customers, contacts or tickets in production for QA. Use the isolated operational-records flow for all mutations, SQL bypass cases and races. `/release-status` records product gaps and required provider/device/business-rule inputs.


## Project prerequisites — 2026-10-16

Apply all 58 migrations before using task dependencies. Open Task dependencies from a project. Add prerequisites only to a not-started task in a planned/active project. Every prerequisite must reach DONE to unblock starting/completing the dependent task. Cancellation does not satisfy a prerequisite: remove the active link while the dependent task is TODO if the dependency no longer applies. Dependencies freeze after the dependent task starts. Source read/task read plus task manage permissions are required for writes. Removed links remain in history. In-memory same-request retry is available on uncertain failures; reload does not retain dependency requests. Use isolated CI for cycles, task state races and raw SQL bypass cases; never create production test projects/tasks.


## Project time review — 2026-10-16

Apply all 59 migrations. Owner has time approval by default; Manager can record/correct time but is not automatically a reviewer. Delegate project read + time read + time approve through a scoped custom role as needed. A reviewer without employee read sees restricted employee details. No mandatory dual-person restriction is imposed.

Open Time tracking from a project, filter review states and inspect an entry's review history. Approve/reject a pending active entry with a reason; reset approved/rejected decisions to pending before reconsidering them. Reset approved time before correction. Decisions do not calculate wages, bill clients or initiate payment. Closed projects and voided entries cannot receive new decisions. Date reports classify current review state, not historical approval state at the chosen work-date cutoff. Retry uncertain requests using their original versioned per-tab payload; definitive failures refresh current entry state. Test all mutations, audits, history and concurrency in the isolated project-time-review flow; do not add production test entries.
