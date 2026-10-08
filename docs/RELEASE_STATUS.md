# Final Arrow ERP release status

This repository is an expanding product foundation. The bilingual `/erp-preview-v6.html` preview contains sample data and does not save changes. It is a separately maintained interface walkthrough, so app changes do not appear there automatically. The authenticated app is deployed at https://final-arrow-erp.vercel.app/dashboard with a dedicated PostgreSQL database. Vercel authentication protects all deployments. The owner account and Final Arrow / FA01 company in OMR are configured; registration is closed.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Organization & access | Tenants, companies, branches, departments, roles, scoped invitations, team suspension, audit events, an organization administration activity viewer and persistent per-email login throttling | Account recovery, verified email, network-level abuse controls |
| CRM & sales | Customers, leads, quotes, orders, internal invoices | Contacts, imports, tax, payments, legal documents |
| Purchasing & inventory | Suppliers, purchase orders, full and partial goods receipts, stock return documents/register and source-linked receipt accruals/return credits, UTC receipt register and CSV, catalog and branch stock ledger | Reservations, valuation rules, unallocated supplier advances |
| Projects | Projects, tasks, employee assignments, status transitions and manual project time entries with audited corrections and scoped time reports | Dependencies, time approval, billing, budgets, resource planning |
| Helpdesk | Scoped tickets, optional customer and employee links, priority and status workflow | Conversations, attachments, notifications, customer portal, SLA rules |
| HR | Employee directory, manager-entered leave requests, searchable daily attendance with date, branch and status filters, scoped CSV reporting and manual monthly payroll drafts with approval, payment recording and printable internal statements | Leave balance rules, payroll rules and bank integration, overnight shifts and separate fingerprint integration |
| Accounting | Internal invoice and expense registers, company chart of accounts, balanced manual and source-linked invoice/expense/POS/payroll/purchase receipt and return journals, reversals, period locks and financial reports | Payment settlement workflows, automated closing, bank reconciliation, taxes, accounts payable and receivable |
| Management | Scoped dashboard and action inbox for leave, expense and purchase drafts | Configurable approval policies, saved reports |
| POS | Branch menu, dine-in/takeaway orders with price snapshots, manual cash/card payment recording, cancellation, printable internal receipts, scoped paid-sales reports with CSV and a kitchen queue | Shifts, refunds, tax, kitchen printers, device payment, stock recipes |
| Other planned modules | Preview cards only | Subscriptions, documents, AI and automation |
| Localization | AR/EN switch and RTL foundation; primary workflows, including sales, purchasing, projects, team access and invitation acceptance, have translated interface text | Server error text, end-to-end translation QA, typography and remaining edge cases |

## Before a real deployment

1. Provision PostgreSQL, secrets, backups, monitoring and a deployment target.
2. Add email verification, account recovery, login abuse controls and an invitation delivery channel.
3. Define financial, HR and document rules with real operating scenarios and test data.
4. Run security, accessibility, performance and end-to-end reviews, including tenant isolation.
5. Enable production registration only after account and abuse controls are ready.

The CI workflow checks migrations, unit tests, database constraints, build and API flows against PostgreSQL. Passing CI means this code slice is internally verified; it does not mean the entire ERP is complete or production ready.

Monthly payroll reports now summarize exact decimal amounts by status and currency across all matching pages, with scoped CSV export (maximum 5000 records). Void records have separate totals. Reports require a month and payroll read permission; no bank transfer is performed.

General ledger journals post manually in company currency, without tax or automatic document posting. Deferred database constraints verify line balance and header totals; posted headers and lines reject edits and deletion. Corrections create a unique linked reversal. Trial balance reports movements and ending debit/credit balances for the selected dates and scope, grouped by account and currency (maximum 20000 lines). A start date excludes prior balances.

POS reports use paidAt and a selected UTC or Muscat date range (maximum 31 days, 5000 paid orders). Summaries separate currencies and cash/card methods, show cash tendered and change separately, and exclude open/cancelled orders. Card entries remain manually recorded payments.

POS menu names, categories, prices and availability can be updated with scoped permissions and an audit event. Existing order snapshots remain unchanged. The cart displays an exact integer-based estimate by currency; server prices remain authoritative and saving menu changes clears the cart.

The POS menu supports category and availability filters over loaded items, with reset and empty-result feedback. Filtering preserves selected cart items. Load-more remains explicit.

The kitchen queue advances WAITING → PREPARING → READY → SERVED for non-cancelled orders, including paid orders. Transitions are audited and guarded against duplicate actions. Database rules preserve payment fields and require ordered preparation timestamps. The queue refreshes every 15 seconds and supports status filters and pagination. Payment and preparation remain separate.

Kitchen cards show waiting, preparation, ready-to-handover and total elapsed durations. Active timers update each second using a database clock anchor and browser monotonic elapsed time; completed stages freeze at their recorded timestamps and total time freezes at handover. Queue data still refreshes every 15 seconds. Durations are displayed as hours:minutes:seconds without an assumed service target.

Kitchen branch summaries count all active orders by waiting/preparing/ready stage and show the oldest stage timestamp, regardless of the selected filter or page. Cancelled and served orders are excluded. List, summary and clock use one repeatable-read transaction. Summary cards link to the corresponding stage filter.

Project time reports require project and time-read permissions, a date range up to 366 days, and at most 5000 non-voided entries. Totals and employee breakdowns use integer minutes; employee names/codes respect employee-read permissions. CSV export escapes spreadsheet formulas. Reports reset after recording or voiding time. These reports do not calculate payroll or costs.

Expense and invoice register reports support date, visible branch, status and text filters, with up to 366 days and 5000 records. Exact Decimal totals remain separate by status and currency; expenses also break down by category. CSV exports escape formulas and responses disable caching. Expense reports use expense dates; invoice reports use creation dates in UTC and do not represent collection or recognized revenue. Reports reset after document changes and company selection.

Internal invoices have scoped printable documents with saved customer, item, quantity, price and currency snapshots, creation/issue/void timestamps, and explicit draft/void labels. Browser printing can save PDF. Tax and payment collection remain separate unfinished features.

Login reserves up to five attempts per normalized email in a 15-minute database-clock window, including successful attempts. Atomic upserts guard parallel requests across app workers; unknown accounts follow the same throttle and password-verification work. Blocked requests return 429 and Retry-After without creating a session. Expired buckets are cleaned in bounded batches after one day. Password input is capped at 1024 characters. This protects individual email targets; distributed attempts against many emails still need network-level controls at deployment.

Account security allows authenticated users to change their own password after verifying the current one, using a separate five-attempt/15-minute bucket. New passwords must differ and contain 12–128 characters. Password replacement and revocation of all user sessions are atomic; a compare-and-set rejects concurrent stale changes. Login session creation locks the user row and verifies the password hash is still current, preventing an old password verification from creating a surviving session after a password change. Users must sign in again. Email recovery is still pending.

Single-item stock movement reports show opening, incoming, outgoing, closing and running balances using exact Decimal quantities. Opening sums all earlier ledger movements; the inclusive date range follows UTC or Muscat time, up to 366 days and 5000 movements. Archived items remain reportable in their visible branch. Repeatable-read transactions keep opening and movement rows consistent. CSV includes explicit opening/closing summary rows and escapes formulas. Item names and units use the current catalog; valuation, stock recipes and reservations remain pending.

Project task registers support title, status and deadline filters. Deadline summaries count all open (TODO/IN_PROGRESS) tasks independently of filters and pagination, using the database date in Muscat. Overdue dates precede today; due soon includes today through the next three days; undated tasks have no deadline. Completed/cancelled tasks have no deadline badge and are excluded from open counts. List and counts share a repeatable-read snapshot; employee names retain scoped visibility. Stale task requests cannot replace results after changing a project or filters. No external notifications are sent.

### Purchase order reporting and print
- Scoped UTC creation-date reports (up to 366 days / 5000 documents), saved supplier search, status/currency totals and supplier breakdown, CSV export.
- Authorized internal purchase-order print/PDF view with saved prices and lifecycle timestamps. Not supplier payments, tax or payable recognition.

### Sales registers and documents
- Quote / sales-order reports scoped by company and branch, UTC creation date, status and customer/number search; exact status/currency totals and CSV (366 days, 5000 documents). Quote customer names are current, order names are saved snapshots.
- Authorized bilingual print/PDF views preserve document statuses, line prices, notes and lifecycle timestamps. No email delivery, taxes or collections.
- Sales lists discard stale responses on company changes; quote customer choices always load from page zero.

### Ledger account statements
- Branch-scoped account statements include earlier opening, debit/credit movements, running and closing balances per currency. Reversals remain included; balance sign is debit minus credit.
- Repeatable-read snapshot, period limit 366 days / 5000 lines, earlier-history cap 20000 lines; explicit CSV opening/closing rows. Current account names; manual journals only.

### Journal print documents
- Bilingual authorized manual-journal views show debit/credit totals, dates, current account names and reversal references; print/save PDF from browser. Related-document links require independent ledger permission.

### Trial balance export
- Currency-separated debit/credit movement and balance totals, balance check, CSV account rows and total rows with scope/date filters. Same ledger permissions and 20000-line cap as JSON; formula-safe CSV. Start dates still select period movements, not historical opening balances.

### Goods receipt documents
- Authorized bilingual print/PDF and JSON/CSV goods-receipt documents show saved supplier/order descriptions and quantities, current item catalog fields and stock-movement references.
- Requires both order-read access in the source scope and stock-read access in the receiving branch. Full and partial receipts, complete inventory-only corrections and source-linked stock returns are available. No valuation, payments or financial supplier credit documents.

### Manual-ledger income statement
- Scoped income statement uses posted revenue/expense account movements, exact currency-separated revenue, expenses and net income/loss; reversals and closing journals remain included. Required inclusive entry dates, 366-day / 20000 relevant-line limits, CSV export.
- Uses current chart account names and manual postings; not automatically fed by documents or a complete statutory financial statement.

### Manual-ledger balance sheet
- As-of inclusive entry-date balances for assets, liabilities, equity and cumulative unclosed revenue/expense earnings; currency-separated balance checks and CSV. Closing journals transfer remaining earnings into equity without double counting.
- Same ledger branch permissions, 20000-line cap; current account labels, manual journals only. Not consolidated currency conversion, annual retained-earnings automation or statutory statements.

### Ledger navigation and company switching
- Direct section links for account setup, journal entry and financial reports. Journal/account responses from superseded requests are ignored when switching company or loading another page. Static bilingual previews include report navigation.

### Preview 4
- New versioned bilingual preview with workspace shortcuts, client-side sample-table search, CSV export of visible sample rows, explicit feedback for demonstration actions and responsive sidebar behavior. Demo records only; no persistence or production database.
- HTML section targets and inline JavaScript syntax validated. Browser execution was unavailable locally because the Chromium executable is not installed.

### Organization activity reports
- Organization administrators can match exact record/user IDs (or SYSTEM), use UTC or Oman day boundaries, and summarize a required period by action, record type and actor. CSV exports all matching pages with current actor names, IDs and timestamps; metadata remains excluded.
- Reports require both dates, at most 366 days / 5000 events, and preserve organization-level user-management authorization. List requests ignore stale responses. Preview 5 shows the new summary workflow with sample records.

### Company ledger period locks
- Authorized ledger-period administrators set an inclusive company cutoff, lower it or reopen all dates with an audited reason. Owner roles receive the new permission. Exact expected cutoff checks prevent concurrent changes from overwriting each other.
- Posting/reversals at or before the cutoff return 409; future-date reversals and reads remain available. SQL insert triggers and shared company locks enforce the cutoff for direct database writers and serialize period changes with journal transactions. Does not create closing entries or lock operational documents.

### Persistent database activation preparation
- User authorized starting a persistent database when needed. ERP cloud project is not provisioned yet; provider organization/project selection and hosting remain pending. Existing Health/NAYROQ projects remain separate.
- Prisma now separates application DATABASE_URL from DIRECT_DATABASE_URL for migrations; CI and environment example set both. db:deploy/db:status scripts and setup documentation are ready. Registration hashes passwords outside the transaction and batches shared permission/role-permission inserts to reduce remote-database latency while preserving existing roles.

### 2026-10-05 — Persistent ERP database provisioned

Dedicated Supabase ERP project in Mumbai is healthy. All 31 Prisma migrations and migrate status succeeded in Core checks #83 (retry after credential correction). Verified 47 public tables, zero unfinished migrations, zero users, and no anon/authenticated public table grants. Temporary bootstrap job removed; application hosting and owner bootstrap remain pending.

### 2026-10-05 — Live review checkpoint

Vercel hosting, owner bootstrap and the real Final Arrow company are complete. Earlier preparation entries above describe historical states. Registration is disabled after bootstrap. Runtime connections use Supabase transaction pooling, one connection per serverless instance; migrations retain the session connection.

Dashboard permission checks are batched in both the page and API. The dashboard now links to all 23 implemented module screens; destination permissions remain independently enforced. Network/JSON failures show a retry message instead of leaving the activity loader indefinitely.

Core checks #87 passed migrations, scope/database tests, build and API flows in isolated PostgreSQL. Live read-only checks confirmed the dashboard, customers, employees and manual ledger load. The real company has no branch yet, so POS setup cannot proceed until a branch is created. Full live operational acceptance remains outstanding; no synthetic business records have been inserted into the real company.

This is an initial review build, not a complete ERP release. Automatic financial posting, tax, banking, payment devices, fingerprint attendance, email recovery and the preview-only modules remain pending.

### Document-to-ledger posting

Issued invoices and posted expenses now have an explicit ledger-posting action in their registers. The user chooses the journal date and accounts: asset/revenue for invoices, expense/asset-or-liability for expenses. Exact source amounts, source currency and branch are copied by the server; zero values, incompatible account types, foreign-company accounts, earlier dates, currency mismatches and closed periods are rejected. No tax calculation or external payment is performed.

A reserved 30-character journal number encodes all 128 source UUID bits in base 36 with SYSI-/SYSE- prefixes. The existing company/number unique constraint prevents duplicate posting, including after a reversal; manual entries and reversal inputs cannot claim those prefixes. Source row locks serialize ledger posting with source voiding. Posted documents must have their linked ledger journal reversed before voiding. Document posting and audit logging commit atomically. No schema migration or changes to existing records are required.

Accounting registers discard outdated list requests during company changes and show connection errors. The new isolated API fixture covers quote → order → invoice → journal → reversal → void, concurrent duplicate attempts, expense posting, permissions, account/company validation, period locking and exact amounts. Live business-flow acceptance is still outstanding.

Paid POS orders also support source-linked posting (SYSP- prefix): asset debit / revenue credit using the actual order total, excluding tendered cash and change. Only paid orders qualify. Payment recording remains manual; no card capture, refund or inventory recipe is performed. The isolated flow test includes POS payment → ledger posting → reversal.

### Full stock movement correction

Stock operators can reverse a complete historical stock movement with a required reason. The server copies the exact opposite Decimal quantity into a new movement dated now, keeps the original, prevents negative/overflow balances, and serializes duplicate corrections with a source row lock. A deterministic correction ID additionally enforces single-use through the stock movement primary key. Reversal movements cannot themselves be reversed.

Recent movements identify corrected originals and correction rows. Purchase-receipt corrections additionally require read access to the originating purchase order. These correct inventory quantities only: receipt/order history stays intact; no supplier credit, refund, tax or valuation entry is created. Source-linked partial stock returns are available; financial supplier credits and refunds remain pending. The isolated API flow covers insufficient stock, concurrent corrections, duplicate/reversal rejection, exact fractional quantities, access and full receipt quantity return. Stock list requests discard responses from a previous branch and show network failures.

### Payroll accrual journals and branch readiness

Approved or paid payroll entries can explicitly post a single accrual journal. Exact base salary plus allowances debit an expense account; net pay credits a payroll liability, and positive deductions credit a separate liability or expense-offset account selected by the operator. Gross pay must be positive; zero net pay omits the zero liability line. All accounts must belong to the company, and journal dates cannot precede the payroll month or fall in a locked period. SYSR- references prevent duplicate posting even after reversal. Payroll row locks serialize posting with status changes; approved accrued payroll requires reversal before voiding. Source data and audit events remain preserved.

This recognizes manually entered payroll only. Payment recording does not settle the ledger liability; settlement still uses a separate manual journal. Deduction rules, taxes, insurance and bank transfers are not calculated or performed. The register exposes accrual posting only to ledger-read/post operators and ignores stale list/employee responses after company changes. Isolated API fixtures cover exact split quantities, zero net pay, invalid accounts, scope, periods, concurrent duplicates and reversal/void behavior.

The real Final Arrow company now has one main branch (MAIN). Live inventory review confirmed the branch and empty stock register; no synthetic operational data was inserted. Core checks #94 passed the full stock correction flow.

### Payroll payment settlement

Paid payroll entries with positive net pay can post a separate SYSW- settlement journal. It debits the exact net-pay liability account from the active accrual and credits a company cash/bank asset. The payment journal date must follow both the recorded payment date and the accrual date. Positive net pay, active accrual, source access, account types, currency, company and ledger period are enforced. Source locking serializes settlement with accrual reversals. Active settlements must be reversed before their accruals; both references remain single-use after reversal. This supersedes the manual-settlement limitation in the preceding checkpoint. Deduction liabilities require separate settlement, and no external funds are transferred.

### Goods receipt register

A server-rendered bilingual receipt register now links from purchase orders and the dashboard. Company, receiving branch and supplier/order/reference search filters preserve pagination and offer authorized print/CSV document links. Receipt access requires both stock-read permission in the receiving branch and purchase-order-read permission in the source order scope; branch-only purchasing roles do not see company-scoped source orders. Original receipt documents remain available after inventory corrections. Quantities are not net stock, monetary valuation or supplier credits. API requests reject duplicate/unknown filters, cap pages and disable caching. Isolated fixtures cover company and branch scope, cross-tenant denial, company-scoped orders, search and invalid filters.

Receipt rows now distinguish original receipt lines whose stock movements have been fully reversed, without changing the source quantities. List rows and reversal counts share a repeatable-read snapshot. Stock movements offer receipt-document links only when the user can also read the source order; internal source-scope fields are omitted from the response. Company-level source receipts stay hidden from branch-only purchase readers even when stock read access exists.

### Partial purchase receipts — 2026-10-06
- Each delivery has its own immutable receipt; positive whole-unit quantities may cover a subset of order lines. Per-line received and remaining quantities are visible in the register and purchase print view.
- Orders remain ISSUED during partial fulfilment (displayed as partially received) and become RECEIVED only when every line is complete. Reports group partially received orders with ISSUED orders.
- Row locks and a database quantity guard reject excess receipt quantities under concurrency. Explicit quantities require a request UUID; identical retries return the saved receipt without adding stock or audit events again. The browser retains the request while a result is unconfirmed and offers retry of the same delivery.
- Stock corrections preserve receipt history and fulfilment quantities. Supplier credits, purchase valuation, fractional-unit purchase orders and cancellation of a partly received order remain unfinished.
- Receipt links require both source purchase read and receiving stock read permissions; order lists show the latest ten accessible receipts, with access to the full receipt register.


### Goods stock returns — 2026-10-07

- `/purchasing/returns` lists saved stock returns with company scope, search and 50-document pagination. Open a saved goods receipt to return a subset of its lines and print the immutable return document.
- Positive whole quantities are capped by both the original receipt's unreturned quantity and available stock in its receiving branch. Receipt and purchase fulfilment quantities remain unchanged; the separate returned counter advances atomically with negative PURCHASE_RETURN movements.
- Source order read/manage and receiving-stock read/adjust permissions are required to create a return. Both read permissions are required for return documents, registers and stock links; sibling branches and tenants cannot see them.
- Request UUIDs retain the exact receipt, reason and line quantities for safe retries. The browser retains unconfirmed requests in session storage and retries the same payload. A successful retry creates no extra movement or audit event.
- Returns and full receipt reversals lock the same source movements. A returned receipt movement cannot be fully reversed; a reversed receipt cannot be returned. Saved return movements cannot be generically reversed.
- An isolated CI test covers permissions, malformed and excessive quantities, concurrent retries, exhausted-source races, reversal races, archived-item returns, immutable records, print/read paths and all-or-nothing rollback on stock shortages. Production has 33 Prisma migrations; no synthetic business records were added.
- Financial supplier credits/refunds, tax and valuation remain separate future work. The repository's standalone ESLint script currently lacks a flat config; production build/type checks and database/API tests are the active checks.

### Purchase receipt accruals and return credits — 2026-10-07

- Saved receipts can post an asset/expense debit and supplier-liability credit. Amounts use the saved purchase-order unit prices multiplied by that receipt's whole quantities, including partial deliveries. This is an explicit journal action, separate from receiving stock.
- Saved stock returns can post a liability debit and credit to the original receipt's exact purchase account. An active original receipt journal is required; the credit date cannot precede the return document or original journal. Posted documents, including reversed ones, cannot be posted again.
- Source purchase-read, receiving-stock read, and receiving-branch ledger read/post permissions apply. Read-only ledger users can inspect linked journals. Registers show scoped posted, unposted and reversed states; users without ledger read receive no journal references.
- Financial posting, full physical stock reversal and parent/child journal corrections serialize on the same receipt. Correct the active receipt journal before reversing its stock. Correct active return-credit journals before the parent receipt journal; parent correction dates cannot precede their dependent corrections. All postings/corrections respect company period locks.
- The source UUID is encoded in reserved SYSG/SYST journal numbers and decoded to verify correction links. Trial balance, income, balance sheet and account statements already include these ordinary balanced journals.
- Isolated CI coverage includes exact multi-price partial receipt totals, duplicate races, original account matching, dependency/reversal races, period locks, currency/scope checks, source-document print paths and hiding financial references after permissions are revoked.
- No cash is transferred. Supplier cash payments/refunds, taxes, freight, foreign-exchange handling, formal supplier credit-note identifiers and inventory costing rules remain separate work. There are still 33 migrations; this slice uses the existing immutable journal schema.

### Supplier source-journal statements
- Authorized AR/EN supplier statements show posted purchase receipt accruals, return credits and their correction journals, with an earlier opening balance and running credit-minus-debit balances per currency.
- Uses source purchase-order permission, receiving-branch stock and ledger permissions, and independent supplier-read permission. An explicit receiving branch narrows the same scope; archived suppliers remain reportable.
- Journal-date filters use UTC, up to 366 days and 5000 period journals; bounded source-document and historical-journal lookups reject over 20000 records rather than truncate balances. Repeatable-read transactions keep opening and period movements consistent.
- CSV export escapes formulas; authorized server-rendered views link to source documents and journals and support browser printing. Supplier name/code search narrows the first 200 selector results.
- This is not a confirmed payable balance: unposted sources, supplier settlements/refunds, taxes/freight and unrelated manual journals are excluded.

### Posted supplier balance overview
- AR/EN as-of report groups receipt accruals, return credits and immutable correction journals by visible supplier and currency. Archived suppliers and zero balances with posted history stay visible.
- Independent supplier, source-order, receiving-stock and ledger read scopes all apply before journal lookup. Receiving-branch and supplier-name/code filters narrow the same visible data; unposted sources and unrelated manual journals are excluded.
- Exact Decimal net, positive and negative totals, journal/correction counts, source statement links and formula-safe CSV. One repeatable-read snapshot; reject more than 20000 source documents/historical journals or 5000 supplier/currency rows without partial totals.
- Taxes/freight, unallocated advances and due-date aging remain separate pending features. These balances are not confirmed supplier balances.

### Receipt-linked supplier payments and refunds

Supplier settlements now record actual payments and refunds against a posted goods receipt. Payments debit its original supplier liability and credit a selected company cash/bank asset. Refunds reverse that direction and require a negative receipt balance after posted return credits. These actions record movements already made; they do not transfer funds.

The database enforces positive amounts, exact balanced journals, original account/currency/source scope, available balance, immutable settlement records and chronological dates. Receipt locking serializes competing settlements and corrections. A saved request ID supports exact retries without duplicate journals; altered retry payloads are rejected. Active settlements must be reversed before the original receipt accrual. Period locks and supplier/order/stock/ledger permissions apply.

The new settlement register, receipt form, supplier statement and supplier balance overview include payments, refunds and journal corrections. There are now 34 migrations. Unallocated advances, bank feeds/transfers, tax/freight, currency conversion and due-date aging remain unfinished. Isolated API tests cover simultaneous requests, direct database overpayments, retry behavior, scope, periods and reversals.

### Custom operational roles and member assignments

Organization owners can create and update up to 100 custom roles at `/settings/roles`, inspect protected built-in templates, and assign up to ten role/scope combinations to an existing member. Permissions are selected from the organization's owner catalog; user administration and organization creation cannot be delegated through custom roles. Action permissions require their module's read rights. Owner access and the built-in Owner/Manager/Viewer roles cannot be edited here.

Assignments replace all prior grants for the selected member, retain suspension status, and revoke that member's pending invitations so old invitation links cannot restore superseded access. Invitations support custom roles and organization/company/branch scopes. Existing sessions use current permissions on their next authorized request. Changes and before/after access are audited.

Tenant-row locks serialize role updates, membership edits and invitation acceptance; expected revisions reject stale competing changes. API fixtures cover cross-tenant isolation, reserved permissions, protected owners, mismatched branch/company scope, concurrent edits, immediate revocation, suspended members and pending invitation invalidation. No additional database migration is required; the existing 34-migration schema is reused.

## 2026-10-08 — Customer invoice collections and statements

Added partial collections and refunds against an issued invoice with an active original receivable journal. Collections debit a selected cash/bank asset and credit the original invoice receivable; refunds reverse that direction and are limited to net collections. Cash/bank and receivable accounts must differ. No external money transfer is initiated.

Saved request IDs provide exact retries, including after a correction, and reject altered amount/date/account/reference/source payloads. Invoice source locks serialize collections, refunds, voids and corrections. The database validates source scope, amount, accounts and dates, rejects overcollection/overrefund, and preserves immutable settlement records. Corrections cannot leave net collections outside zero through invoice subtotal. Active settlements must be corrected before reversing the original invoice journal. Company period locks apply.

Invoice, customer, source-order and ledger read permissions are all required; recording and correcting also require ledger posting. Registers respect each source branch independently. Customer statements include invoice accruals, collections/refunds and linked reversals, calculate only the original receivable account, keep currencies separate, and offer printable/CSV output with opening/closing balances. Internal invoice printing shows recorded net collections and outstanding balance to authorized users. Unposted sources and unrelated manual journals are excluded; tax is still not calculated.

The new isolated CI fixture covers exact decimals, duplicate retries, competing collections, source permissions, foreign accounts, refund dependencies, direct database bypass attempts, immutable records, period locks, chronological corrections, CSV escaping, statements and five new/updated screens. The initial collection/statement slice passed CI run 124, including eight API flow tests. Customer balances now aggregate original receivable movements by customer/currency as of a selected journal date, with branch/search filters and CSV/print output. Their additional CI checks are required before final verification.

Remaining release work includes tax configuration/calculation, bank reconciliation, account recovery and broader acceptance testing of real operational flows. Full production readiness is not claimed.

## 2026-10-08 — Bank reconciliation workbench

Company-wide ledger readers can import and review bank statements at `/accounting/bank`; imports, matches, cancellations and statement corrections additionally require ledger posting. Branch-only access cannot expose company bank activity. Statements use company-currency ASSET accounts, exact signed three-decimal amounts, up to 500 CSV lines and a 366-day date range. Opening balance plus movements must equal closing balance; active statement periods cannot overlap.

Matching links one imported bank movement to one book line with the same amount, direction and currency. Request UUIDs support exact retries, active matches are unique on both sides, and cancellation retains history. Erroneous statements can be voided only after cancelling their active matches; their data and reference remain reserved, while a corrected statement with a new reference can replace the period. SQL guards preserve imported lines and reject late appends, altered amounts, deleted records and cancelled-match revival. No external bank connection or money transfer occurs.

Balances include book movements through the statement end, earlier outstanding book movements and all unmatched non-void imported bank movements through that date. A zero difference alone cannot complete review when older offsetting bank movements remain unmatched. This is a live review, not a frozen reconciliation certificate. Missing movements and bank fees require legitimate balanced journals; split/aggregate matching and automated bank feeds remain future work. Matching can continue after a ledger period lock because it does not change journal data.

Four additive migrations bring the schema to 40 migrations. The initial schema CI run 128 and production migration passed; an additional constraint explicitly requires non-null correction reasons. Local production build and CSV unit checks accompany an isolated ninth API workflow covering concurrency, permissions, exact retries, historical unmatched movements, database bypass attempts, corrections and period locks. Full application CI verification is pending publication of this slice. Remaining release work includes tax configuration/calculation, account recovery and broader real operational acceptance testing.
