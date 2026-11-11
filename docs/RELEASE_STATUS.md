# Final Arrow ERP release status

This repository is an expanding product foundation. The bilingual `/erp-preview-v6.html` preview contains sample data and does not save changes. It is a separately maintained interface walkthrough, so app changes do not appear there automatically. The authenticated app is deployed at https://final-arrow-erp.vercel.app/dashboard with a dedicated PostgreSQL database. Vercel authentication protects all deployments. The owner account and Final Arrow / FA01 company in OMR are configured; registration is closed.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Organization & access | Tenants, companies, branches, departments, custom roles, scoped invitations, team suspension, audit history, login throttles, password changes and offline backup-code recovery | Email recovery/verification and delivery, network-level abuse controls |
| CRM & sales | Customers with multiple scoped contacts, leads, quotes, orders, printable internal invoices with optional Oman VAT snapshots, source-linked collections/refunds and customer statements/balances and posting-date and due-date source aging, audited payment-term amendments, CSV customer imports | Wider tax coverage, unallocated advances, statutory documents |
| Purchasing & inventory | Suppliers, purchase orders, full and partial goods receipts, stock return documents/register and source-linked receipt accruals/return credits, UTC receipt register and CSV, catalog with CSV item/supplier imports, branch stock ledger and audited manual reservations, including explicit sales-order links, with available balances, and completed branch transfers with paired corrections | Physical sales fulfilment, automatic allocation/conversion, valuation rules, unallocated supplier advances |
| Projects | Projects, tasks with acyclic prerequisites, employee assignments, status transitions and manual project time entries with independent review, audited corrections and scoped time reports, independent manual budgets/cost events, exact current-cost reconciliation, linked invoice/collection tracking and a scoped cross-project workload/time overview | Invoice generation from time/milestones, capacity calendars/estimates and automatic cost allocation |
| Helpdesk | Scoped tickets, optional customer and employee links, priority and status workflow with immutable internal follow-up, explicit UTC deadlines and current overdue register | External conversations, attachments, notifications, customer portal, SLA rules |
| HR | Employee directory, manager-entered leave requests, searchable daily attendance with date, branch and status filters, scoped CSV reporting and manual monthly payroll drafts with approval, payment recording and printable internal statements | Leave balance rules, payroll rules and bank integration, overnight shifts and separate fingerprint integration |
| Accounting | Internal invoice/expense registers, optional Oman VAT snapshots for invoices, purchase receipts/returns, expenses and POS, chart of accounts, balanced manual and source-linked journals, customer/supplier settlements and statements/balances, reversals, period locks, financial reports, audited source payment-term amendments and imported bank statement full/partial allocations and corrections with retained internal snapshots | Statutory tax documents/filing, inclusive prices, imports/reverse charge, automated/final closing, unallocated settlements, statutory reconciliation certification and bank feeds |
| Management | Scoped dashboard, report directory, private saved filters for customer/supplier balances and posting-date/due-date aging, invoice/expense/quote/sales-order/purchase-order register presets, company payment-term templates and action inbox for leave, expense and purchase drafts | Configurable approval policies, presets for other report types |
| POS | Branch menu, dine-in/takeaway orders with price snapshots, manual cash/card payment recording, cancellation, printable internal receipts, scoped paid-sales reports with CSV, saved Oman VAT, full/partial refund accounting, branch cash shifts/closure and a kitchen queue | inclusive tax pricing, kitchen printers, device payment, stock recipes |
| Other planned modules | Preview cards only | Subscriptions, documents, AI and automation |
| Localization | AR/EN switch and RTL foundation; primary workflows, including sales, purchasing, projects, team access and invitation acceptance, have translated interface text | Server error text, end-to-end translation QA, typography and remaining edge cases |

## Before live operational acceptance

The existing hosted review environment is not evidence of business or regulatory acceptance. Complete the [release acceptance checklist](RELEASE_ACCEPTANCE.md) against the exact candidate commit before using the ERP for real operations:

1. Verify deployment/database configuration, migration state, backup restoration, monitoring and rollback. Do not reprovision existing infrastructure merely to satisfy a checklist.
2. Configure and test email verification/recovery and invitation delivery, or explicitly approve a restricted pilot with offline recovery and manual invitation handling. Keep registration closed and verify network-level abuse protection.
3. Obtain approved financial, tax, HR, stock and document rules. Unsupported requirements remain release blockers for any workflow that needs them.
4. Run scoped security, accessibility, performance and end-to-end reviews in both languages, including tenant isolation, permission revocation and interrupted/repeated requests.
5. Reconcile expected ledger, tax, stock and cash results using isolated acceptance fixtures. Keep production inspection read-only; do not seed demonstration financial records.

The configured Core checks workflow audits dependencies, runs ESLint and TypeScript checks, applies migrations, runs unit and database tests, builds the app and exercises API flows against disposable PostgreSQL. It does not run a browser acceptance suite. Passing CI verifies the tested code slice, not the entire ERP, current live service health or production readiness. Dated CI results below are historical evidence; verify the exact candidate commit separately.

## Implementation history

The notes below describe incremental releases; older exclusions describe their original slice. The current matrix above and latest dated release entries are authoritative.

### Combined bank-allocation verification — 11 November 2026

The integrated candidate passed all 75 migrations on fresh isolated PostgreSQL 17, 244 unit/component tests, nine database tests, 36 API checks, the production build and TypeScript checks. ESLint remains at zero errors and 23 existing warnings; dependency audit reports no vulnerabilities. Bank allocation, full-match and snapshot API suites also passed with both eight- and one-connection application pools. Regressions cover actual waiting readers behind permission revocation, cross-action/account request UUID identity, current versus cutoff capacity, safe abandonment and uppercase source IDs.

A populated upgrade retained original active/cancelled match metadata and byte-exact version-one saved snapshot JSON, summary and digests. Actual authenticated HTTP checks replayed committed old snapshot requests, read/downloaded/rendered saved v1 data, rejected an uncommitted stale v1 preview and produced new v2 previews. The migration manufactured no request outcomes. These are isolated technical checks, not live browser, operational or regulatory acceptance. No live database changes, manual deployment or merge were performed.

### Explicit partial and split bank allocations — review candidate

Bank review now supports explicit positive three-decimal allocations between same-direction movements in one company, bank account and currency. Repeating allocations supports partial, one-to-many and many-to-one matching. Active allocation sums cannot exceed either original source. Existing full-match requests retain their original equal-amount, unused-source semantics. No bank transaction, original statement amount, journal or ledger balance is rewritten.

Current available capacity includes all active allocations, including later bank bookings. Book outstanding through an earlier statement cutoff considers only bank bookings through that cutoff. The two values are shown separately; a historical outstanding amount already allocated later cannot be offered again. Incomplete imported bank lines continue to block reconciled status even when their amounts offset. An allocation can be cancelled once with a reason, then replaced by a new allocation. Statement void requires cancelling all active allocations first. This records reconciliation, not money movement or final accounting close.

Every write binds the intended authenticated operator and checks current company-wide ledger read/post access inside the transaction. Tenant, globally shared request UUID and account locks serialize permission changes, duplicate requests, capacity, corrections and recovery. An immutable audited request registry binds both successful and abandoned action identities, including cancellation and void. Explicit recovery returns an already-saved exact outcome or permanently blocks every delayed duplicate before clearing the browser request. Web Locks and verified durable storage protect cross-tab recovery; malformed, denied or uncertain responses remain pending. Legacy actor-less requests remain quarantined and require original-account outcome review rather than automatic resubmission.

Live reconciliation now reads one coherent SQL source snapshot after fresh post-lock authorization. Version-two saved snapshots retain deterministic allocation and cancellation details plus current/cutoff residuals. Previously saved version-one JSON, summary and content digests remain untouched, readable, printable and downloadable; committed old capture retries return their original records. Uncommitted old previews are rejected as stale. Source/history/outstanding/size limits reject rather than truncate.

One atomic additive migration derives historical full-match amounts from their immutable bank sources and preserves all prior match metadata. New mutations receive database timestamps. Independent database guards enforce capacity, scope, immutable records, exact request/effect identities and same-transaction audits. Apply migration and its matching app build only in a separately authorized controlled rollout; no live migration, merge or manual deployment is performed by this review work. This excludes opposite-direction netting, FX conversion, tolerances/writeoffs, automatic missing journals, external feeds and payment execution. See [allocation semantics and recovery limits](BANK_ALLOCATIONS.md).

### Combined inventory and financial verification — 11 November 2026

The integrated review candidate passed all 74 migrations on fresh isolated PostgreSQL 17, 213 unit/component tests, two database tests, 35 API checks, the production build and TypeScript checking. ESLint has zero errors and 23 unchanged warnings; the dependency audit reports no vulnerabilities. Focused order-hold, transfer, payment-term and bank-snapshot API suites also passed with a one-connection pool. Coverage includes current authorization, intended-operator and unit guards, concurrent stock/reservation changes, exact response recovery, paired corrections, safe request cancellation and movement-report metadata.

A populated 70-to-74 upgrade preserved all original columns of 1,116 existing rows across eleven document, template, bank, journal and inventory tables. All 56 legacy holds remain manual. The six new history tables remained empty; the intended new permission grants went only to Owners. Legacy movement transfer links and balance opening offsets remain null. No history, stock or financial activity was manufactured by migration.

These tests used disposable fixtures only. They do not replace browser, mobile/RTL, print, accessibility, full-load, backup/restore or business acceptance. No candidate migrations or financial/stock fixtures were applied to the live ERP, and no manual deployment or merge was performed. Check the exact published review commit's CI separately before rollout.

### Completed branch stock transfers — review candidate

Operators can record an already-completed transfer of one active company-wide inventory item between two different branches of the same company. The explicit positive stock-unit quantity, reference and reason are retained with immutable company, branch, item, unit and operator snapshots. The database atomically subtracts the source quantity and adds exactly the same quantity at the destination. Existing reservations are untouched; source availability and destination capacity must both permit the operation.

Current stock read/adjust and a separate transfer-management permission apply independently at both branches, even on exact retries. Only Owner receives the new permission by default. Register, detail, print and CSV require both read scopes. Branch-only stock readers see only their own generic movement quantity, not the other branch, reference, reason or transfer link. Authorization filtering precedes pagination and the 5,000-record filtered CSV limit.

A full correction records one opposite transfer with its own reason, actor and current time. It requires available stock at the original destination and the original unit; it never deletes the original and cannot itself be corrected. Generic movement reversal cannot reverse a single transfer leg. Paired movements, audit records, immutable links and stock projections are independently enforced in the database.

On the first transfer for a balance, an immutable opening offset preserves its existing quantity relative to existing movements. Later balances must reconcile to that offset plus the complete movement history. Existing receipts, returns, adjustments and reservations continue to work. Legacy movement deletion or reassignment and first-transfer initialization serialize on affected balances. The migration itself does not populate transfers, offsets or movement links. Movement reports retain their recorded-movement-only arithmetic and disclose any undated opening offset separately in JSON, CSV and bilingual warnings; they do not invent a historical stock date.

Requests bind the intended operator and the unit displayed in the form. Changed accounts or units are rejected before stock changes. Browser locks protect exact pending requests across tabs. Unknown responses remain pending. Explicit abandonment is resolved under the same server request lock: an already-saved transfer is returned, otherwise an immutable audited cancellation permanently prevents every delayed duplicate before the browser may forget it. Cancellation never reverses recorded stock.

The bilingual workspace includes current-authorized detail/printing, a paginated register and formula-safe filtered CSV. Recording time is not a backdated physical-stock date. This does not provide in-transit inventory, approvals, intercompany transfers, branch-owned item remapping, unit conversion, valuation, journals, tax, sales fulfilment or logistics. See [transfer semantics and limits](BRANCH_STOCK_TRANSFERS.md). No live stock or financial records were changed.

### Intended operator and cross-tab financial request protection — review candidate

Payment-term amendment and bank snapshot creation/designation requests now send the expected operator separately from their immutable business payload. The server compares this concurrency guard with the authenticated account before mutation; it never substitutes for authorization. A previously uncommitted request from a stale tab cannot be recorded under a different account, and a mismatch does not authorize discarding an uncertain request. Existing version-one pending envelopes retain their original operator and payload.

Payment-term preparation, submission, confirmed clearing and explicit rejected-request discard are serialized across browser tabs. Another tab cannot replace the sole durable request during an uncertain save. Unavailable locks or unverifiable storage fail closed. These safeguards supplement the existing exact UUID, current source permission, sequence, immutable-history and audit checks.

### Order-linked manual stock holds — review candidate

Sales orders now have a bilingual inventory-hold workspace. Operators explicitly choose the branch, inventory item and positive stock-unit quantity, with an optional descriptive sales-order line. The system does not infer a SKU, convert commercial units, cap quantities to order demand, consume stock, dispatch goods, invoice or post journals. Existing generic holds remain manual and are not retrospectively assigned to orders.

A separate source-order management permission requires order read access; independent current stock read/adjust rights apply at the actual stock branch. Owner receives the new permission by default. Company-wide order access does not require company-wide stock visibility. Generic stock history filters linked references before pagination, and generic release cannot bypass source-order authorization. Database guards preserve immutable source/item/unit snapshots, scoped relationships, active reserved balances, server times and same-transaction audits.

New linked holds require an open order. Closing or cancelling an order does not release existing holds; explicit full release remains available after order closure or item archive. Active linked holds prevent changing the item's stock unit. Corrections use release plus a new hold; the existing 5,000 lifetime holds per balance remains. Tenant, request, item, balance and order locks serialize permission changes, retries, receipts, stock adjustments and order closure without changing purchase receipt behavior. Request UUIDs cannot be reused between create and release actions.

New linked requests bind the intended signed-in operator and the stock unit displayed in the form. A changed login or unit is rejected before any effect; exact historical replay still uses the original saved unit. The UI retains exact actor/order/stock-scope payloads across uncertain outcomes and uses browser locks to prevent another tab overwriting a pending request. Corrupt or unavailable durable storage blocks submission. Generic conflicts remain unresolved. Only an authenticated, exact-request check proving no record exists and the order is permanently closed permits explicit discard; delayed retries still cannot create a hold. Selected-page CSV/print shows its filter and page limits, preserves separate stock units and escapes spreadsheet formulas.

One additive migration creates the immutable order link and source classification. No production stock or order records were changed. Real browser, mobile, printing and accessibility acceptance remain required. See [stock-hold semantics and limits](ORDER_STOCK_HOLDS.md).

### Combined financial workflow verification — 10 November 2026

The integrated review candidate passed all 72 migrations on fresh isolated PostgreSQL 17, 146 unit/component tests, two database tests, 33 API checks, the production build and TypeScript checking. ESLint has zero errors and 23 unchanged warnings; the dependency audit reports no vulnerabilities. Focused payment-term and bank-snapshot API checks also passed with a one-connection pool. Regressions cover actor changes after lost responses, source/tenant scope, current permission revocation, exact response identities, uppercase UUIDs, large supported totals and independent database guards.

A populated baseline upgraded from 70 to 72 migrations without changing existing source documents, templates, bank records or journals. Existing Owners received only the intended new management permissions; Manager/Viewer roles did not, and migrations created no amendment/snapshot history. These checks used isolated fixtures only. No candidate migrations, financial records or manual deployment were applied to the live ERP. Verify the exact review-branch commit's CI and obtain the remaining browser, operational and regulatory acceptance before rollout.

### Internal bank-reconciliation snapshots — review candidate

The bank statement review can retain an immutable internal observation, including incomplete or voided reviews with their status clearly shown. A preview freezes the statement, company/account labels, all bounded book movements through the statement end, relevant imported bank movements, active match details, exact totals and outstanding classifications. The source query uses one SQL statement snapshot; save re-reads the source data and rejects a changed preview. Later bank matching, corrections, source labels and journals do not rewrite the retained observation.

This is not an auditor signature, regulatory certificate, approval, final closing or posting lock. A zero difference is not sufficient when unmatched bank movements remain. Exact currency-separated arithmetic and the source reconciliation's existing semantics are preserved. A SHA-256 content checksum is verified independently by the application and database; it is a checksum, not a digital signature or proof of external approval.

Company-wide ledger-read access is required for every preview, list, detail, print and download. Separate create/manage permissions default only to Owners and may be delegated through custom roles. Current permission checks apply even to exact retries. Tenant locking serializes application permission revocation, while bank-account/source locks and database constraints protect creation and designation changes. Source scope, immutable rows and same-transaction audit metadata are enforced independently of the UI.

Operators may explicitly supersede a snapshot with a newer snapshot for the same bank account, statement period and currency, or restore its current designation, with a permanent reason. This appends a versioned event; it never deletes a snapshot or automatically marks another as approved. Replacement time ordering prevents cycles. New events are limited to 1,000 per snapshot, with exact pending-request replay retained at the limit.

The bilingual UI provides saved history, retained input detail, printing and JSON download with current authorization. Pending creation/designation payloads retain their exact UUID and content across interruptions. Reports fail rather than truncate when they exceed 20,000 book movements, 20,000 imported movements, 5,000 outstanding book movements or 16 MiB of canonical JSON. Near-limit checksum performance was measured on isolated PostgreSQL; production source-query, browser print and full-load acceptance remain separate gates.

One additive migration creates snapshot and designation history plus scoped permissions. It has not been applied to the live ERP by this work. Apply and verify candidate migrations only in an authorized isolated acceptance environment before reviewing schema-dependent screens. No bank connection, external transfer, live financial fixture or production migration is part of this review work.

### Exact financial aggregates and return allocation — review candidate

Monetary report aggregation now uses exact integer thousandths instead of the default 20-significant-digit Decimal arithmetic where supported record counts and amounts can exceed that precision. Financial/sales registers, customer/supplier balances and statements, trial balance, balance sheet, income statement, account statements and dashboard expense totals preserve the final thousandth, including cancelling histories and currency-separated totals. Stored values, report permissions, row caps and response formatting are unchanged. No global Decimal configuration is altered.

Purchase-return VAT now calculates cumulative allocation as an exact integer ratio with the existing HALF_UP rule. One accepted-input regression uses 61,192 units at 945,764,174.115 and a first return of 52,006 units: the correct first-return tax is 2,459,270,581,951.235. The former intermediate precision produced .234, which conflicted with the database's independent allocation guard. The new API regression posts both returns and proves their tax sums to the original saved tax. This is a precision correction, not a new tax policy or retrospective change to saved records.

The isolated arithmetic slice passed eight new actual-module regressions, all 93 base-plus-arithmetic unit tests, two database tests, 30 API workflows, build and TypeScript checks, with zero lint errors and the same 23 existing warnings. Integrated verification is required after combining with other candidate changes. This check used disposable fixtures only; no live financial data was inspected or changed.

### Audited payment-term amendments — review candidate

Invoice and purchase-receipt originals remain immutable. Authorized operators can record an already-approved replacement term and due date, or explicitly clear both, with a required permanent reason. This records the agreement; it does not obtain counterparty approval, send reminders, add charges, change financial amounts, move stock or money, or post journals. Invoices may be draft or issued; voided invoices do not accept new amendments. Existing legacy documents can receive a first amendment without rewriting their original snapshot.

The history is append-only, limited to 1,000 amendments per source, scoped to its original company/branch and timestamped by the database. Exact request UUIDs, optimistic sequence checks, current authorization even on replay, tenant/source locking and same-transaction audit guards protect interrupted and concurrent submissions. Existing and new Owners receive separate invoice/receipt payment-term management permissions; custom roles may delegate them with the required source-read permissions. Source readers can inspect the original, current terms and paginated history without management permission.

Due-date aging selects the latest amendment recorded before the exclusive end of the report's UTC as-of day, otherwise the original terms. A recorded clear means no due date; it does not fall back to the original date. JSON and due-date CSV identify the cutoff, original/current terms and amendment sequence/time. Earlier reports are not silently rewritten by later amendments. Invoice/receipt print pages continue to show the original snapshot and link to current terms/history.

Bilingual forms retain an unresolved exact request in actor/source-bound browser storage before sending, block replacement submissions until it is resolved, and distinguish rejected from uncertain outcomes. Revision changes remount the form with current defaults, while exact pending retries survive. Tests include a one-connection database pool, in-flight permission revocation, equal timestamps at UTC cutoffs and no financial/stock effects. Browser acceptance remains a separate gate.

Local verification passed all 71 migrations, 104 unit/component tests, two database tests, 32 API checks, production build and TypeScript checks. Lint remains at zero errors and 23 existing warnings; dependency audit reports no vulnerabilities. Focused API coverage also passed with a one-connection pool. These are local candidate checks, not live deployment or browser acceptance.

One additive migration creates the amendment history and permissions. It has not been applied to the live ERP by this work. Verify migrations in an isolated acceptance environment before reviewing the feature there; do not deploy schema-dependent code against an unmigrated database.

### Saved document-register reports — review candidate

Private saved reports now also cover invoice, expense, quote, sales-order and purchase-order registers. Presets retain the company, optional branch, valid document status and search text. Dates can be a fixed inclusive range of at most 366 days, the current UTC month through the opening day, or the previous full UTC calendar month. Existing customer/supplier as-of presets and their exact request retries remain supported.

Opening a preset resolves its dates again and checks current ownership and source-report permissions. The dedicated register view keeps the selected scope explicit and offers the source report's existing CSV export and exact currency-separated totals. Filters, not results, are stored. This does not add collections, payable recognition or financial posting to document registers. Preset changes keep immutable scope, audited versions, archive/restore, optimistic concurrency and exact retries after uncertain responses.

This candidate adds one database migration for date-range/status fields and constraints. Apply and verify it in the intended isolated acceptance environment before reviewing the new feature there. It has not been applied to the live ERP by this work; publishing a review branch does not constitute an approved rollout. Real browser and business acceptance remain required.

Local verification passed all 70 migrations, 85 unit/component tests, two database tests, 30 API workflows, production build and TypeScript checks. Lint has zero errors and 23 existing warnings; dependency audit has zero advisories. A populated legacy preset retained every existing field through the migration, and API regressions replayed old-format create/update digests without new writes. Component tests simulate interruption, repeated reads, navigation and stale responses; they do not replace browser acceptance.

### Bilingual recovery screens — 2026-11-09

Application errors, root-layout failures and missing pages now have Arabic/English recovery screens with explicit text direction, accessible navigation and independent fallback styling. Error screens offer a deliberate retry and warn that an interrupted transaction must be checked before it is submitted again. They never display the original exception, stack or diagnostic digest. Dashboard/login links make full requests and retain the normal authorization boundary; no business records or pending requests are changed automatically.

Seven component/source regressions cover locale selection, safe text, navigation, retry callbacks and root fallback output. A production HTTP workflow checks both localized 404 responses and the unauthenticated dashboard redirect. Browser layout, screen-reader behavior and interactive error-boundary recovery still require operational acceptance.

### Release hardening candidate — 2026-11-08

API mutations now validate the browser Origin and Fetch Metadata before reaching route handlers. JSON bodies are required, with narrow exceptions for existing bodyless logout and invitation revocation. Non-browser JSON clients remain supported. Regression tests cover forged origins, sibling sites, opaque origins, unsupported content types and the existing bodyless flows.

The lockfile upgrades Next.js to 15.5.29 and Zod to 4.6.7, with patched PostCSS/source-map dependencies and scoped Prisma/ESLint transitive overrides. The dependency audit reports zero advisories as of this review. Validation regression tests confirm that oversized VAT arrays stop before inspecting elements, while existing defaults, normalization and strict-field checks are preserved. Review the overrides when upgrading their parent packages.

The candidate passed a local production build, TypeScript checking, all 44 unit tests, all 69 migrations on disposable PostgreSQL 17, both database checks and all 28 isolated API workflows. Fourteen HTTP-rendered smoke checks also passed for AR/EN login, authenticated dashboard/reports/release status/payment terms, company selection and logout revocation; these do not substitute for browser interaction tests. ESLint now has a working configuration and is enforced in CI, together with type checking and high-severity dependency auditing; 23 pre-existing React Hook warnings remain. API test servers bind to loopback and run with bounded concurrency.

These changes are a review candidate, not a production rollout or completion of the remaining modules. Real Chromium acceptance could not run because the execution environment prevented its required Unix sockets, including after reviewed execution. Browser layout, interaction, accessibility and mobile acceptance remain unverified. No production records or database schema were changed by this verification.

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

Four additive migrations bring the schema to 40 migrations. The initial schema CI run 128 and production migration passed; an additional constraint explicitly requires non-null correction reasons. Local production build and CSV unit checks accompany an isolated ninth API workflow covering concurrency, permissions, exact retries, historical unmatched movements, database bypass attempts, corrections and period locks. CI run 130 passed all six unit checks, two database checks, nine API workflows, production build and the 40-migration production deployment. Vercel deployment succeeded and the authenticated Arabic bank import screen loaded successfully. No synthetic production financial records were created. Remaining release work includes tax configuration/calculation, account recovery and broader real operational acceptance testing.

## 2026-10-08 — Offline account recovery

Authenticated users can generate ten private recovery codes at `/settings/security` after proving their current password. Only SHA-256 hashes of 128-bit random codes are stored; raw codes appear once in the response and can be downloaded privately. GET returns only the current count. A new set replaces all prior codes; codes are never stored in browser storage, URLs or audit metadata.

`/recover` accepts an account email, a saved code and a different 12–128 character password. Per-email throttles reserve attempts before validation, including unknown accounts; responses do not distinguish unknown accounts from bad codes. User-row locks and password-hash comparisons serialize regeneration, password changes and recovery. Successful recovery invalidates every code and every session, creates no signed-in session, and retains existing memberships/permissions. Ordinary password changes also invalidate recovery codes. Separate setup/recovery throttles, no-store responses and no-referrer metadata protect these flows.

One additive migration brings the schema to 41. Local production build passed. The new isolated tenth API flow verifies private storage, replacement, retries/concurrent code use, throttles, invalid codes, session revocation and password-change invalidation; CI run 133 passed six unit checks, two database checks, all ten API workflows, build and production migration. Vercel deployment succeeded; the authenticated Arabic security screen loaded with zero saved codes, without creating live codes or changing credentials. This supports users who previously saved backup codes; email recovery and recovery without a saved code remain unconfigured. No live user's credential or backup codes were changed during verification.

### Oman invoice VAT — 2026-10-08

Company VAT settings at `/accounting/vat-settings` are opt-in for registered OMR companies, require company-wide company-update plus ledger-read, and use revision-checked audited saves. Seller tax number/name/address, effective date and output liability account are required when enabled. Existing invoices remain unchanged.

New invoice lines require explicit standard 5%, zero-rated or exempt treatment. Order prices exclude tax; tax rounds per line to three decimals, half up. Immutable snapshots preserve seller details, output account, net amounts, classifications and taxes. Posting separates gross customer receivable, net revenue and output VAT. Collections/refunds, reversal caps, statements and invoice register totals include recorded VAT. Print/PDF exposes net, tax and gross while retaining the internal-document label.

The additional isolated API/database flow tests mixed line treatment and rounding, direct SQL rejection, scope permissions, competing profile saves, unchanged history, future dates, zero tax and gross payment/refund/reversal dependencies. Purchases, expenses and POS VAT, tax-return reporting, tax credit notes and statutory e-invoicing remain outstanding. No live company was marked VAT registered or populated with test financial records.

Validation: Core checks #138 passed 42 migrations, six unit checks, two database checks, the production build and all eleven isolated API flows. Vercel deployment succeeded; authenticated live Arabic settings and invoice pages loaded with registration left unconfigured.

### Purchase input VAT — 2026-10-08

Receipt journal posting explicitly classifies every line and records the supplier invoice reference and VAT number when standard tax is charged. Deductible tax posts to an optional scoped input VAT ASSET account; non-deductible tax increases purchase cost. Gross supplier payables flow through payments, refunds and statements. Zero, exempt and no-VAT-charged classifications remain distinct.

Supplier credit posting retains original classifications, supplier details and input account, requires a credit-note reference, and allocates saved tax cumulatively across partial returns under the receipt lock. Immutable same-transaction snapshots and exact UUID-derived source numbers are database-enforced. Existing non-tax journals remain unchanged. This implements internal accounting, not automatic legal eligibility, statutory tax documents, filing, inclusive prices, imports/reverse charge or fractional recoverability. Expenses and POS VAT remain outstanding.

Five additive migrations bring the schema to 47. A twelfth isolated API/database flow covers mixed deductibility, gross settlement/refund/reversal dependencies, concurrency and rounding remainders, immutable snapshots, foreign accounts, no VAT charged, changed/disabled profiles and period locks. Core checks #144 passed all 47 migrations, six unit checks, two database checks, the production build and all twelve isolated API flows. Vercel deployment succeeded and the authenticated Arabic settings screen displayed the input VAT account and sales/purchase activation controls. Live registration remains unconfigured; no synthetic production financial records were created. The production migration job also succeeded.

### Expense input VAT — 2026-10-08

Expense ledger posting now explicitly classifies one VAT-exclusive net amount and records supplier name/reference and supplier VAT number for standard tax. Deductible VAT debits the saved input ASSET account; non-deductible VAT increases expense cost; cash/bank or liability is credited gross. Three-decimal half-up rounding and distinct zero/exempt/no-tax treatment apply. Existing posted non-tax journals remain unchanged.

Immutable original-transaction snapshots and financial source fields retain history. VAT expenses cannot reopen; void requires the original journal reversal. Expense reversal now additionally requires source expense-read permission and retains the original input account. Period locks apply. Register cards show net/tax/deductible/gross/cost; expense report/category and dashboard totals show net plus non-deductible VAT, while CSV separates all amounts. Document-status reports do not apply journal reversal effects.

Three additive migrations bring the schema to 50. A thirteenth isolated API/database flow covers exact rounding/cost, cash and liability credits, competing postings, branch/source permissions, immutable and missing/late/incorrect snapshots, future/disabled profiles, original-account reversal and period locks. Core checks #148 passed all 50 migrations, six unit checks, two database checks, the production build and all thirteen isolated API flows. The production migration script and Vercel deployment succeeded. Authenticated Arabic expense and VAT-settings pages are checked read-only; no live VAT registration or synthetic financial records are created. This is internal accounting; legal eligibility, mixed treatments within one expense, inclusive pricing, imports/reverse charge, partial recovery percentages, POS VAT, statutory tax documents/filing and expense settlement/refund allocation remain outstanding.


## POS VAT — 2026-10-08

New POS orders for explicitly active OMR registration classify every line as standard 5%, zero or exempt using VAT-exclusive menu prices. Per-line three-place half-up tax is saved with the original seller/output account in the order transaction. Existing orders retain their values; later menu/profile changes and late source line/snapshot writes cannot rewrite financial history. Cash/card recording uses gross; cash change subtracts gross.

Paid-order journals debit gross asset, credit net revenue and positive output VAT to its original liability account. Exact source audit and amounts are database-enforced. Reversal copies every original account and additionally requires POS-read plus ledger-read/post. It does not issue a refund or change PAID status. Cards/receipt print and paid-date JSON/CSV separate net/tax/gross; paid registers retain reversed orders. No real company registration is enabled and no production financial fixtures are inserted.

Schema 51 adds POS snapshots and source-journal guards. A fourteenth isolated API/database flow covers line classifications and rounding, future/disabled profiles, gross tendered/change, competing pay/cancel and postings, immutability, direct database invalid/missing tax and journals, source/branch permissions, original-account reversal, receipt/report output and period locks. Core checks #152 passed all 51 migrations, six unit checks, two database checks, the production build and fourteen isolated API flows. Vercel deployed successfully; authenticated Arabic POS loaded the new VAT status and report copy without creating orders or enabling company VAT. Schema 51 production migration had already succeeded in core checks #151 before the app deployment. Statutory invoices/e-invoicing/filing, real POS refunds, shifts, inclusive prices, discounts and device/stock integration remain outstanding.


## Full POS refunds — 2026-10-08

Paid orders with an active original ledger journal can now record a full refund already made, using the original gross cash/bank, net revenue and saved VAT liability accounts. A UUID identifies an exact immutable retry; altered payloads and a second active full refund are rejected under the order lock. This records accounting and does not transfer money, refund a terminal or restore inventory. Partial/line refunds and refund to a different asset account remain unsupported.

Refund reversal requires POS manage/read and ledger read/post. The original sale cannot reverse until active refunds are corrected; dates cannot precede later accounting activity. Two additive migrations bring the schema to 53 and enforce immutable same-transaction sources, scoped exact accounts/tax amounts, source audit, exact audited reversal lines and indexed dependencies. Corrected refunds retain their original record and UUID; a genuine replacement uses a new UUID.

Refund history links original/refund/correction journals and appears on internal receipt print. The separate UTC journal-date refund report shows active net/tax/gross and reversed counts/gross, with current-state CSV for all matching records. Original PAID status and paid-date sales totals remain unchanged; these registers are not historical balances, net sales or tax-return reporting.

The fifteenth isolated API/database flow covers tax and non-tax refunds, exact concurrent retries, different-ID conflicts, retry immutability after correction, original-account preservation after settings changes, source/branch permissions, refund-before-sale reversal dependencies, period locking, direct SQL wrong/missing snapshots/audits/amounts/corrections, report/CSV/receipt output and unchanged paid-register totals. Core checks #156 passed all 53 migrations, six unit checks, two database checks, the production build and fifteen isolated API flows. Both production migrations succeeded (#154 for refund sources, #156 for exact corrections/indexes); Vercel deployed successfully. Authenticated Arabic POS and the live refund report were checked read-only without creating orders/refunds or configuring VAT. Operational acceptance with real completed refunds and statutory credit-note generation remain outstanding.


## Partial POS refunds — 2026-10-16

Operators can record refunds of selected original line quantities, with a gross/net/VAT preview. Quantities and unit prices come from the immutable order; tax is allocated proportionally from each line’s remaining saved tax, rounded half up to three places, with the last remaining portion receiving the exact residual. Correcting earlier refunds restores their quantities and tax without rewriting later records. Whole-order refunds remain available only without active partial refunds; selected quantities can refund all remaining units.

Migration 54 adds immutable original-transaction refund lines and distinguishes FULL/PARTIAL while preserving legacy full refunds. Source locks, exact UUID retries (independent of line input order), source/branch permissions, period locks and original-account corrections apply. Direct SQL must retain original quantities, exact remaining tax, source accounts and same-transaction audits. No terminal action, money transfer, statutory credit note or inventory return occurs.

The refund register/CSV includes refund kind and preserves current reversal status; receipt/history show full/partial records, while original PAID amounts and paid-date sales remain unchanged. The sixteenth isolated API flow exercises mixed lines and small rounding remainders, repeated and competing requests, non-last corrections, exact final totals, compatibility with full refunds, immutable/late/foreign/missing/incorrect SQL snapshots, source permissions and period locks. Core checks #159 passed migration 54, the production build and all sixteen isolated API flows, six unit checks and two database checks. The production migration succeeded. Two additional retry-decoder unit checks cover restoring full/partial request payloads and rejecting malformed or wrong-scope cache entries. Unconfirmed requests are retained in per-tab session storage when available; definitive failures/success clear the cache, while uncertain failures preserve the original UUID. A single-pass quantity/tax index keeps source calculations bounded. No real sales, refunds or VAT configuration were created for QA.


## Branch cash shifts and drawer closure — 2026-10-16

A branch can activate one shared open cash shift with its actual opening count. After its first shift, all payments and refunds require an open shift. Source transitions capture immutable drawer events atomically, including gross cash sales (tendered minus change), card sales, cash/card refunds and current authenticated cashier identity. Refunds against older orders affect the currently open shift; earlier closed snapshots do not change.

Expected cash equals opening plus cash sales minus cash refunds plus recorded cash in minus cash out. Card records do not change drawer cash. Ledger reversal does not undo a physical drawer event. Record only actual reconciled cash movements separately; otherwise retain the discrepancy in the counted variance/reason. Closing requires a reason for any non-zero difference and freezes counted/expected cash, signed variance, actor and timestamps. It neither transfers money nor posts a GL adjustment. Supervisor sign-off, multiple drawers/terminals per branch, denomination counts, hardware capture and statutory closure certificates remain separate work.

Open and cash-movement requests use exact UUID retries; identical close retries replay the frozen count and reason. Unconfirmed requests remain in versioned per-tab storage when available. Closed history and events reject edits/deletion. Branch locks serialize source recording with opening/closing, prevent duplicate active shifts and block unfunded cash outs. Audits are required for opening, manual cash entries and closure. Shifts are capped at 5000 events and history uses 50-row paging; scoped CSV includes frozen closure and all movements, with formula-safe text.

Migrations 55/56 add source events, lifecycle checks, audits and provider-role hardening. The seventeenth isolated API flow covers concurrent opens/retries, current cashier attribution, cash vs card, partial/full refunds, journal correction vs physical cash, cash in/out, invalid raw writes, scope permissions, immutable close, closed-shift payment rollback, new-shift refunds and concurrent payment/closure. Core checks #165 passed all 56 migrations, eight unit checks, two database checks, the production build and seventeen isolated API workflows. Production migration and Vercel deployment succeeded. Authenticated Arabic /pos displayed the shift opening controls and empty history in read-only QA on 2026-10-16. Production QA creates no shifts, payments, refunds or movements.


## Cash counting worksheet — 2026-10-16

Shift opening and closure offer an optional bilingual worksheet with up to 30 denomination/count rows in the shift currency. Operators enter actual denominations and whole piece counts; exact integer thousandths avoid floating-point rounding, including large totals. Blank rows are ignored; incomplete, negative, fractional-piece and overflow entries cannot supply a total. Operators explicitly copy the worksheet sum into the actual counted-cash field and see counted-minus-expected variance before submitting a closure. Opening amounts retain their original server limit. The server still verifies the final cash balance under the branch lock. Only the final counted amount is saved; denomination breakdown is temporary and is not an audit record. This does not add supervisor approval or denomination certificates.

Shift list fetches ignore superseded or unmounted responses so a slower earlier refresh cannot overwrite newer data. Two unit checks cover exact totals, signed variance, large amounts and invalid/overflow counts.


## Customer and supplier source-balance aging — 2026-10-16

Bilingual customer and supplier aging reports group positive open invoice/receipt balances into 0–30, 31–60, 61–90 and 91+ days from the original journal posting date in UTC. This is posting-date aging, not an overdue or contractual due-date report; invoices and receipts do not yet have payment-term due dates. Negative source balances remain separate signed negative document balances, with no cross-document allocation or FIFO assumptions. Zero-balance documents are omitted even when their historical journals remain in the existing balance register. Currency-separated party totals and open document details reconcile exactly to the filtered source balances.

Company, source branch, name/code and inclusive journal-date filters use the existing intersections of customer/supplier, sales/purchase source, invoice/stock and ledger read permissions. Original documents, receipts, posted returns, collections/payments/refunds and dated corrections are read in one repeatable-read transaction. Supplier returns remain attributed to their original receipt. Unrelated manual journals and unallocated advances are excluded. Saved VAT already included in the source control-account balance remains included. No new write operation or database migration is introduced.

Reports link each open document to its source/settlement details and offer print styles plus formula-safe CSV containing party summaries, currency totals and every open document with original posting date, age and balance. Existing safety limits reject oversized reports rather than truncating them: 20000 sources/journals and 5000 party/currency groups. No synthetic live financial records are used for QA. Two exact-arithmetic unit checks cover bucket boundaries, negative credits, zero-net parties, currency separation, large totals and CSV escaping. Existing customer/supplier isolated API flows now verify historical settlements/returns/corrections, source detail reconciliation, permissions, invalid dates, CSV and both page routes.

Core checks #170 passed all 56 migrations, twelve unit checks, two database checks, the production build and seventeen isolated API workflows, including the expanded customer/supplier and saved-VAT coverage. Vercel deployed successfully; authenticated Arabic customer/supplier aging pages and their empty scoped document tables/CSV controls were inspected without creating production financial records. Negative amounts are described as negative source balances rather than a single debit/credit classification shared between receivables and payables.


## Customer contacts, internal ticket follow-up and delivery checklist — 2026-10-16

Migration 57 adds customer contacts and permanent internal ticket messages. Contacts inherit customer read/update scope, support searchable name/email/phone, name/role/contact details/notes, version-checked edits and reversible archive/restore. Parent archival blocks changes while preserving read history. Up to 1000 contacts per customer, including archived records, and 50-row pages are supported. IDs/source/creation identity are immutable; deletion is rejected. Creation retries retain the original UUID and complete payload; a changed contact cannot be replayed as its original creation payload. Version conflicts require reload instead of overwriting a teammate's change.

Ticket follow-up inherits ticket read/manage scope. Notes are plain text for the authorized internal team only: no email, customer message, notification or account grant is sent. Author identity, timestamp and content are immutable; corrections append a new note. A ticket permits up to 5000 notes and descending 50-row pages. Closing the ticket serializes with note insertion and retains read-only history; exact successful note retries still replay after closure. The notes API exposes author display name only, without account email.

Both tables enforce scoped parent foreign keys, active scoped actors, source locks and deferred audits bound to the transaction, parent and record version. RLS is enabled; provider client grants and public function execution are revoked. Invalid/wrong-scope/old-version tab retry caches are ignored; uncertain network failures retain the original payload when session storage is available, with in-memory fallback. No production fixtures are created. A new eighteenth isolated API workflow covers role/branch/tenant isolation, duplicate retries, competing contact updates, parent/contact archives, raw SQL mutation/audit rejection, note pagination and close races. A retry decoder unit check covers contacts and notes.

The authenticated bilingual `/release-status` page distinguishes implemented workflows, remaining product development, services/devices to connect and operating rules to define. It is a release checklist, not a runtime health monitor or a claim of complete ERP delivery. Customer portal, attachments, outbound conversations and notifications remain separate work.


## Project task prerequisites — 2026-10-16

Migration 58 adds source-scoped, audited task prerequisite links. A dependent task must still be TODO and its project PLANNED/ACTIVE when adding or removing a link. Self-links, foreign-project sources, cancelled prerequisites, duplicate active pairs and direct/indirect cycles are rejected. Project row locking serializes complementary concurrent edges. All active prerequisite tasks must be DONE before starting/completing the dependent task, including direct SQL transitions; cancelled predecessors remain blocking until their link is removed. Dependencies become fixed once the dependent task has started. Removal preserves immutable source/actor/time history, with exact same-ID add/remove replay and no deletion or reactivation of removed links.

Read requires project and task read rights; writes additionally require task manage. Limits are 5000 active links/10000 lifetime links per project, with 50-row active/history pages and explicitly paged task choices. Project task lists show unfinished prerequisite counts in the same repeatable-read snapshot as tasks and disable blocked start/complete controls; the server remains authoritative. Ambiguous dependency requests retain their original body only while the component is mounted; unlike contacts/notes, they are not stored across reload. Active-pair uniqueness also prevents duplicate active links. These links do not schedule dates, approve time, bill projects or define budgets.

The eighteenth isolated operational flow also covers DAG chains, complementary concurrent cycle attempts, exact retries, foreign/self/duplicate links, blocked API/raw SQL task transitions, completed/cancelled prerequisites, immutable started-task links, removal history, paused projects and source permissions.

Core checks #175 passed all 58 migrations, thirteen unit checks, two database checks, the production build and eighteen isolated API workflows. Schema checks #172/#174 deployed migrations 57/58 before the corresponding application pages. Live Arabic contact/follow-up entry pages, the delivery checklist and the project register were inspected read-only; there are no real project records to exercise a live dependency form, and none were created for QA. Production catalog checks confirm RLS and no anon/authenticated table privileges on all three new tables. Security advisors report only informational RLS-without-policy notices, consistent with the server-only access model and revoked browser-role grants.


## Independent project time review — 2026-10-16

Migration 59 adds immutable sequenced review decisions and a guarded current-state projection on project time entries. Time starts PENDING; a reviewer approves or rejects it with a reason. A recorded decision must reset to PENDING before a different decision. Every step retains actor, authoritative timestamp, reason and source scope, with a transaction-bound audit. Competing expected-sequence decisions cannot overwrite one another. Exact UUID retries replay their original record after later decisions, source correction or project closure. Each entry allows up to 1000 review decisions and paged history of 50.

`project-time:approve` is separate from time management and requires project/time read access. Existing Owner roles receive it; Manager roles do not receive it automatically. Owners can delegate it through custom roles. A permitted reviewer can review their own recorded effort; this is not a mandatory two-person policy. Review never creates payroll, billing, payment or ledger records. Closed projects and voided entries reject new reviews. Original recorded effort/source fields are immutable, and approved entries require reset before void/correction. Approval and void serialize on the project, including database guards.

The time register can filter current review state and includes latest decision/history. Date-bounded time reports/CSV can filter ALL/PENDING/APPROVED/REJECTED; statuses are current at query time, not historical as of the selected work-date period. Voided entries remain excluded. CSV includes current state, review sequence and entry ID; employee visibility remains separately scoped. Review-only users can access the time page from the project register without time-management rights. Unconfirmed decisions retain their exact payload in versioned scoped per-tab storage when available, with mounted-component fallback.

A nineteenth isolated API workflow covers separate reviewer/recorder permissions, hidden employee details, competing and duplicate reviews, reset/correction, immutable source/decision/audit guards, approval/void races, long decision history, closed projects, exact retries after correction and immediate permission revocation. The retry-decoder unit check rejects wrong tenants/projects/entries, versions and malformed payloads. No production operational or financial fixtures are used.


### Atomic catalog imports — 16 October 2026

`/data-import` creates up to 500 customers, suppliers or catalog items per UTF-8 CSV batch. Authorized users choose an exact company or branch, download header-only templates, preview normalized records and all validation errors, then explicitly save. Reading and creating the selected module in that same scope are both required. Company-wide targets require company-wide rights. Codes are trimmed/uppercased; duplicates, existing and archived company codes are rejected without disclosing other-branch records. Quoted commas, multiline cells and Unicode are supported. CSV is bounded to 350 KB in the file picker and 350,000 characters in the API.

Imports create definitions only: no updates, opening balances, stock quantities, prices or payments. Every row and its creation audit commit in the same transaction as an immutable batch/audit. Source provenance cannot be removed, reassigned, deleted or appended after commit; normal source edits/archive remain available. Batch metadata contains scope, kind, actor, count, hash and time, not the original CSV. History is exact-scope, paginated and permission checked. UUID retries compare normalized payload, creator and scope and return the original receipt after later source edits/archive. An ambiguous save retains the exact request in versioned per-tab storage until confirmed/discarded; storage failure limits retries to the mounted page. Pending files may contain personal data and should be cleared on shared devices.

Migration 60 and schema-only Core checks #180 passed existing unit/database/API/build checks and deployed to the dedicated ERP database before the application changes. The added isolated import workflow covers permission boundaries, preview without writes, all three kinds, company code collisions, archived rows, exact replay, competing imports, complete rollback, provenance mutation, missing audits and revoked access. No synthetic production operational records are created for verification.

Core checks #181 passed all 60 migrations, seventeen unit checks, two database checks, the production build and twenty isolated API flows, including atomic catalog imports. The production migration recheck and Vercel deployment succeeded. Authenticated Arabic live QA confirmed source/scope controls, customer duplicate-code errors with save disabled, and quoted Unicode item preview without committing data. Production inspection found zero import batches, RLS enabled, no browser-role table grants and no browser-role execution on import guard functions. Security advisors report only the expected informational RLS-without-policy notice under the server-only access model. Full ERP delivery still requires the remaining product capabilities, provider/device integration and business acceptance listed above and at `/release-status`.


### Private reusable report presets — 18 October 2026

`/saved-reports` stores private filter presets for customer/supplier source balances and posting-date aging. Save the active report filters from any of those four report pages, or create a preset in the personal reports workspace. Company, source branch and report kind are fixed for a preset; name, party search, date rule and archive status are versioned edits. Choose a fixed UTC date, UTC today at opening, or the previous UTC month end. A null branch means all currently accessible branches, so its coverage follows later permission changes. Every opening reauthorizes the owner and target report and recalculates current source data. The preset contains no result amounts, frozen financial snapshot, arbitrary URL/query/SQL, scheduling or outbound delivery. Export/print use the existing authorized report.

Presets belong only to their creator, including when another user is an organization owner. Company/branch foreign keys, active membership, immutable owner/scope, consecutive versions, a 100-preset-per-user/tenant cap including archives, and same-transaction creation/update audits are database enforced. Records are archived/restored rather than deleted. Creates use an exact UUID/digest receipt even after later edits/archive. Edit retry recognizes the most recently accepted request; an older conflicting edit receives 409 and must be refreshed. Versions are bounded at 1000. The client preserves pending requests in versioned, actor/scope-validated per-tab storage; when unavailable it retains the request only in the mounted page. Requests are reauthorized even on replay. Lists use permission-filtered private pagination of 25.

Schema-only Core checks #184 passed the existing unit/database/API/build suites and deployed additive migration 61 before the application routes. New isolated tests cover privacy from other members and tenant owners, all four report targets, dynamic/fixed UTC dates, permission revocation, branch filters, safe redirect encoding, concurrent creates/edits, exact receipts, stale conflicts, archive/restore, raw provenance/audit/version bypass attempts, the 100-preset cap and pagination. Production QA remains read-only and creates no demonstration presets or financial records.

Core checks #186 passed all 61 migrations, nineteen unit checks, two database checks, the production build and twenty-one isolated API workflows. Saved-report opening uses fixed internal relative redirects so it remains on the browser's origin behind hosting proxies. Vercel deployment succeeded. Live authenticated Arabic inspection confirmed the empty private workspace, available report/scope/date controls and transfer of customer-aging filters to the preset form, without saving any production presets. Production catalog checks confirm RLS, no browser-role table grants and no browser-role execution on either guard function; advisors show only the expected informational RLS-without-policy notice. The saved report collection was empty during QA. Full ERP delivery and additional report types remain subject to the scope checklist above.


### Manual ticket resolution deadlines — 19 October 2026

`/helpdesk/deadlines` provides a current, source-scoped ticket register with overdue/upcoming/no-deadline/inactive classification, source branch, ticket status, priority and number/subject search, print and formula-safe CSV. Evaluation uses one captured UTC time per report; resolved/closed tickets are inactive and only open/in-progress tickets can be overdue. Equality at the exact deadline is upcoming; lateness begins strictly afterward. CSV is recalculated when downloaded. Counts cover the selected filters, with a strict 5000-row limit and explicit rejection rather than truncation. Report rows do not fetch customer/employee identity details.

From a ticket, `/helpdesk/[id]/deadlines?tenantId=...` shows the current manual deadline and permanent paginated change history. Ticket read is required for viewing/reporting; read plus manage is required to set/change/clear. Each change requires a reason and expected sequence, with exact UUID retries and versioned per-tab pending requests. Current deadline projection, source scope, active ticket/actor, immutable events and same-transaction audits are database enforced under the ticket lock. A missing audit rolls back both event and projection; concurrent edits cannot silently overwrite. Exact prior retries remain available after later changes or closure, subject to current permissions. Each ticket supports up to 1000 changes.

Deadlines are explicit UTC instants between 2000 and 2099. Legacy/new tickets begin without deadlines. Reopening retains the previous deadline, which can become overdue again, until explicitly changed/cleared. Resolved/closed tickets cannot receive new deadline changes. This is manual work tracking, not configurable SLA contracts/calendars, response-time tracking, pause rules, automatic escalation or outbound notification delivery. No operational records or synthetic deadlines are created in production for QA. Schema-only Core checks #188 passed the existing unit/database/API/build suites and deployed additive migration 62 before the application routes. New isolated mutation/SQL/race tests cover the new flow; local unit checks and production build passed.

Core checks #189 passed all 62 migrations, twenty-one unit checks, two database checks, production build and twenty-two isolated API workflows. Ticket deadline coverage includes active/resolved/closed transitions, reopening retention, competing changes, status-change races, exact retries after closure, SQL projection/history/audit guards, restricted party identities, long history pagination, the 5000-row report bound and formula-safe CSV. Production RLS/table/function privilege checks passed; advisors report only the expected informational RLS-without-policy notice. The deadline-change collection was empty during inspection. Manual deadlines also appear in the existing ticket cards. Authenticated production visual inspection still requires a signed-in browser session; mutation and source-backed page coverage use isolated fixtures only.


## Explicit payment terms and due-date aging — 31 October 2026

New internal invoices and individual goods receipts optionally retain a contractual label and explicit UTC due date (both or neither). Labels are descriptive, not a formula; dates are not inferred from them or from posting/receipt timestamps. Dates may precede posting for late-entered supplier documents. Migration 63 keeps older documents undated and guards both fields against updates at the database level, including drafts. Existing creation audits include the terms. Receipt exact retries compare the full saved terms as well as quantities/scope. Each partial receipt can have its own agreed date.

Separate customer/supplier due-date reports reuse the authorized historical source-balance snapshot, settlements, returns and corrections. Positive amounts classify as not due/due today, missing date, 1–30, 31–60, 61–90 or 91+ days overdue; negative amounts remain separate. All buckets reconcile to party/currency balances. Original posting-date reports and saved presets retain their original basis. Overdue CSV explicitly identifies basis, dates and signed days past due, with formula-safe cells; print and source settlement links are provided.

No automatic reminders, payment-term catalog/defaults, installments, business-day adjustment, contractual renegotiation, legacy-date backfill, unallocated advances or statutory document compliance are included. Changing permanent terms requires a future audited amendment workflow; never silently overwrite or infer older agreements. No synthetic live financial records are created.

Core checks #194 passed all 63 migrations, 22 unit checks, two database checks, production build and 22 isolated API workflows, including updated customer/supplier settlement and partial-receipt scenarios. Schema-only #193 applied migration 63 before application rollout. Vercel application deployment succeeded. Production metadata confirms the guard is an invoker function with no anon/authenticated execution, and zero dated production source documents; security advisors report only the expected informational RLS-without-policy notice. The live due-date route redirects to login, so signed-in visual acceptance remains pending.


## Manual branch stock reservations — 31 October 2026

Authorized stock readers/operators can create manual holds against existing branch stock balances and fully release them with reasons. Quantity/reference/source/creation identity are permanent. Release retains the original record, actor and authoritative UTC timestamps; release cannot be undone. Quantity changes require release and a new reservation. No physical stock movement, accounting journal, payment or order fulfilment is created. There is no automatic expiry, partial release/consumption or sales-order linkage.

Migration 64 adds immutable reservation history and a guarded reserved-quantity projection. Physical quantity must always cover reserved quantity, so manual withdrawals, supplier stock returns and negative movement reversals cannot consume held goods. Release before legitimate dispatch/return. Balance row locks serialize competing holds/releases/stock changes; same-transaction audits are required and a deferred aggregate check rejects direct projection corruption. Active membership and source-item eligibility are checked. Records cannot be deleted; source balance scope becomes immutable after any history. Each balance supports at most 5000 lifetime holds, including released ones. Migration 65 indexes active-hold reconciliation by balance. Server-only RLS/table/function privileges are retained.

Creation UUID retries match actor, balance, exact decimal quantity and normalized reference, even after release or item archive. Release UUID retries match the original release actor and reason; a competing release returns conflict. Every request reauthorizes current inventory-stock read/adjust scope. Pending requests retain their exact actor/tenant/company/branch payload in versioned per-tab storage when available, with in-memory fallback. Current physical/reserved/available values appear together on the stock page; historical stock-movement reports remain physical movement reports. Reservation history has active/released/all filters and 50-row pages.

Verification uses isolated fixtures only: duplicate/concurrent holds and releases, reserve-versus-withdraw races, exact residual quantities, revoked roles and branch/tenant boundaries, archived-item release, SQL scope/projection/audit/history rejection, pagination and stock reversal protection. Production must not receive synthetic stock or reservation records for QA.


## Private project budgets and manual costs — 31 October 2026

Migration 66 adds append-only project budget/cost events and independent project-budget read/manage permissions. Existing and new Owner roles receive these permissions; Manager and Viewer do not receive them by default. Custom roles require project read plus budget read before managing. Basic project registers do not expose budget amounts or event history. Every page/API/CSV request authorizes the exact company/branch source and active membership. Project scope becomes immutable after budget history exists.

Initialize a total budget in the current company base currency. The first event fixes the project's tracking currency permanently, even if the company currency later changes. Every request explicitly includes the displayed currency. Later budget revisions replace the budget total and preserve reasons/old amounts. Positive manually recorded actual costs require a valid UTC date from 2000 through 2099 and cannot be future dated. Costs may precede project creation when recording prior real costs. A linked exact full-cost reversal corrects each cost at most once; original events cannot be edited/deleted. Record a legitimate replacement separately.

Current budget, net recorded cost, remaining amount and overspend use exact thousandths, without floating point or cross-currency conversion. Overspend is displayed, not blocked. All cost/reversal history contributes to the current view; no historical-as-of budget report is implied. This is manual project tracking, not ledger posting, expense/payroll import, payment execution, billing, automatic labor costing or statutory reporting. Operators must avoid double-recording costs.

Project row locks serialize sequence-checked changes and project closure. Exact UUID retries match source, original actor, expected sequence, action, currency and normalized payload; they replay after later revisions, corrections or closure but always reauthorize current access. Database guards enforce source/currency/actor/status/sequence, same-transaction audit and immutable events. Each project supports 5000 lifetime budget/cost/correction events. Versioned per-tab pending saves retain actor/source/request details, with in-memory fallback when unavailable. Current summary and all-history CSV share an authorized repeatable-read snapshot; history pages contain 50 rows and cost correction state reflects full history. CSV cells are formula-safe, and print uses the current view.

All mutation, concurrency, raw-SQL, role-revocation, currency-retention and long-history QA uses disposable test fixtures only. No production project budgets or costs are seeded for verification.

Core checks #200 passed all 66 migrations, 25 unit checks, two database checks, production build and 24 isolated API workflows. Budget tests cover separate read/manage delegation, Manager/Viewer default denial, branch/company-wide/tenant isolation, exact and competing revisions/corrections, original retries after correction/closure, immutable source/event/audit SQL guards, fixed tracking currency after a company change, full CSV and 57-event pagination, plus immediate permission revocation. Vercel deployment succeeded. Production checks confirm zero budget events, server-only RLS/table privileges and no browser-role execution of the three invoker guard functions; advisors report only the expected informational RLS-without-policy notice. Signed-in visual acceptance remains pending. A dedicated cost-versus-project-closure race is also included in the isolated budget flow.


## Project invoice assignments and source collections — 31 October 2026

Migration 67 introduces permanent project/invoice assignments with a single active project per whole invoice. Link an existing issued internal invoice in the same company; a branch project accepts only that branch's invoices. Company-wide projects can use allowed branches. Unlinking requires a reason, preserves the original link and permits a later assignment to another project. Linking/unlinking never creates or changes an invoice, journal, collection, payment, budget or project cost. Invoices are still created through the existing sales-order workflow; time/milestone billing and splitting amounts between projects remain separate work.

Independent project-billing read/manage permissions default only to Owner, including new tenants. Custom roles require project, invoice, order, customer and ledger read rights. Each read/CSV/candidate search intersects the current source scopes, so users see only authorized invoice/customer/order/ledger combinations, with totals for those selected sources and filters only. No hidden-record count is returned. Basic project/invoice registers do not automatically include assignment history. Candidate search lists eligible issued, unassigned invoices with 50-row pages.

The current report separates issued gross, active posted gross, unposted gross, net recorded collections/refunds after corrections and posted open balance. It includes immutable invoice VAT in gross amounts. Currency totals remain separate. Unlinked and voided links remain visible in selected history but contribute no issued/project totals. Financial values are current source values, including on old unlinked rows; this is not a historical assignment-time snapshot or as-of accounting report. Only source-linked journals/settlements contribute. Original posting scope/currency/gross must reconcile; reports reject more than 20000 selected settlement records and can be narrowed by invoice number. Rows/summary/CSV use a repeatable-read snapshot.

Project and invoice row locks serialize assignment competition, source status changes and project closure. SQL guards enforce source/actor/status, same-transaction audits, permanent history and a partial unique active-invoice index. Project scope and invoice financial/source identity become immutable after assignment history exists. Each project supports 1000 lifetime links, with 50-row history pages. Exact creation and unlink UUID retries match the original actor/source/payload and remain safe after unlink/reassignment/closure, subject to fresh permissions. Versioned per-tab pending requests preserve source and actor, with mounted-page fallback.

QA writes only disposable fixtures: concurrent exclusive assignment, exact retries, unlink/reassignment, source posting/collections/refunds/corrections/voiding, branch/company/tenant permissions and revocation, SQL audit/history/source guards, long history, CSV, and link-versus-project-closure races. No synthetic production invoices or links are created.


## Private due-date report presets — 31 October 2026
Migration 68 adds explicit CUSTOMER_OVERDUE and SUPPLIER_OVERDUE preset kinds. The two due-date pages transfer company/branch/search/fixed UTC date filters into private presets. Opening reauthorizes source permissions and recalculates amounts through dedicated due-date routes; posting-date presets retain their existing meaning. Fixed/today/previous-month-end rules, private ownership, versioning, archive/restore and bounded retries retain existing guarantees. No balances are frozen and no notifications are scheduled.


## Reviewed calendar-day payment terms — 31 October 2026
Invoice and receipt forms now offer immediate/7/15/30/60/90-day and custom 0–3650 calendar-day calculations from an explicitly selected UTC start date. Apply copies a descriptive label and calculated due date into the existing editable fields for review; editing the description does not recalculate the date. Weekends are included. Date arithmetic rejects invalid calendar days and dates outside 2000–2099. Existing saved terms and pending receipt payloads remain unchanged. This is an input calculator, not a company-managed terms catalog, business-day schedule or amendment/backfill workflow.


## Cross-project employee workload — 7 November 2026

The `/projects/workload` report combines current open tasks and non-voided recorded time across permitted projects. Project, task and time read scopes intersect; employee-read scope independently filters assigned tasks and time at query time. Unassigned authorized tasks remain separate. Hidden employees, their source IDs and activity do not appear in totals or CSV. Employees with matching activity remain visible when inactive; employees with no matching activity are omitted. No new permission or write is introduced.

An explicit UTC comparison date classifies current tasks as overdue, due today/within three calendar days, later or undated. This date is not a historical task snapshot. The selected UTC work-date range covers at most 366 inclusive days; current review states separate pending, approved and rejected minutes. Open projects (planned/active/on hold) are the default; users can select a particular current project state or all states. Project code/name search and project branch filters apply to both tasks and time. Minutes are recorded effort, not remaining estimates, capacity, scheduling, payroll, billing or costs. Capacity calendars, work estimates and forward allocations remain unfinished.

One repeatable-read snapshot provides source details, employee/project totals and evaluated time. Up to 5000 tasks and 5000 time entries are allowed independently; exceeding either rejects the entire report instead of truncating totals. Web tables show 50 rows per page; totals always cover the entire selection. An explicit full print view exposes all selected rows. Formula-safe full CSV retains scope/date/current-state context, including an empty-report scope row. Navigation and downloads recalculate current values and reauthorize. All fixture writes for verification use an isolated database; none are seeded in production.

Core checks #207 passed all 68 migrations, 30 unit checks, two database checks, production build and 26 isolated API workflows, including the new workload report. The isolated flow verifies branch/company/tenant boundaries, independent task/time/employee permissions and immediate revocation, narrower employee visibility on company-wide projects, current review categories, inactive staff, cancelled-project filtering, void exclusions, formula-safe full CSV, source-free reporting, pagination and the 5000-task rejection. Authenticated production visual acceptance remains pending.

## Report navigation and Arabic typography — 7 November 2026
The authenticated `/reports` directory groups 25 existing financial and operational destinations with Arabic/English name/description search. It contains no business totals and does not expand permissions; every source destination reauthorizes. Dashboard navigation now links directly to the report center, customer/supplier due-date aging and employee workload. Saved-report introductory text includes due-date aging. Regular/bold Tajawal are bundled locally under their SIL Open Font License for Arabic screens and controls; no third-party runtime font request is required.


## Company payment-term templates — 7 November 2026

Migration 69 adds company-wide reusable labels and calendar-day periods. The immutable name (3–80 characters), document description (3–120) and whole calendar days (0–3650) are shared across branches. Active names are unique case-insensitively within a company. Definitions start active and can be permanently archived once with a reason; history is never edited/deleted. Archive then create a replacement to change a definition, optionally reusing its old name. The lifetime limit is 1000 definitions per company including archived records.

Separate payment-term read/manage permissions apply. Owner receives both by default; Manager/Viewer receive read only. Branch readers can use the shared company catalog, while creation/archive requires company- or tenant-wide manage access; branch manage grants cannot change the shared catalog. Custom roles may delegate these permissions. Every request rechecks membership and current permissions. Database company locks serialize competing names, UUID retries, archives and the lifetime limit. Guards require an active actor, immutable source fields, authoritative times and same-transaction audit. RLS is enabled and browser roles cannot access the table or guard functions directly.

The bilingual settings page shows active/archived/all history in pages of 50 and retains uncertain exact saves in versioned actor/company-scoped per-tab storage. Create retries survive later archive; archive retries match actor, source, reason and UUID. Permission changes apply even to retries.

Invoice and individual-receipt forms can explicitly select an active template, choose an agreed UTC start date, calculate and apply the resulting editable description/date, and review before saving. Weekends count; dates must remain within 2000–2099. Definitions are input conveniences, not bindings: no template ID or ongoing dependency is attached to a document, manual terms remain supported, and saved invoice/receipt snapshots never follow later archive/replacement. Archived templates stop appearing on fresh active catalog reads; already copied or pending document input retains its explicit agreed fields. No existing documents, installments, credit limits, automatic defaults or due-date amendments are introduced. Enter in calculator date/day inputs applies the calculation without submitting the surrounding document form.

Verification writes only disposable CI fixtures, including copied invoice snapshots; no live financial or template fixtures are seeded. Authenticated production visual acceptance remains pending.

Core checks #211 passed all 69 migrations, 32 unit checks, two database checks, production build and 27 isolated API workflows. The template flow covers exact concurrent creation/archive retries, conflicting active names, shared branch reading with company-only management, tenant/company isolation, immutable SQL/audit guards, copied invoice snapshots after archive/replacement, full 1000-definition history, 50-row pages, the lifetime cap and immediate permission revocation. Schema-only #209 applied migration 69 before application rollout. Production metadata confirms RLS, zero browser table grants, invoker guard functions with no anon/authenticated execution, and no seeded template rows; advisors contain only the expected informational RLS-without-policy notice for server-only tables. The management link retains the selected company and opens in a labeled new tab so unsaved document input remains open.
