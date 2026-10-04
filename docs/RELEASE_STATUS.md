# Final Arrow ERP release status

This repository is an expanding product foundation. The bilingual `/erp-preview-v3.html` preview contains sample data and does not save changes. It is a separately maintained interface walkthrough, so app changes do not appear there automatically. The authenticated app needs PostgreSQL and has not been deployed for public use.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Organization & access | Tenants, companies, branches, departments, roles, scoped invitations, team suspension, audit events, an organization administration activity viewer and persistent per-email login throttling | Custom role editor, account recovery, verified email, network-level abuse controls |
| CRM & sales | Customers, leads, quotes, orders, internal invoices | Contacts, imports, tax, payments, legal documents |
| Purchasing & inventory | Suppliers, purchase orders, full goods receipts, catalog and branch stock ledger | Partial receipts, returns, reservations, valuation |
| Projects | Projects, tasks, employee assignments, status transitions and manual project time entries with audited corrections and scoped time reports | Dependencies, time approval, billing, budgets, resource planning |
| Helpdesk | Scoped tickets, optional customer and employee links, priority and status workflow | Conversations, attachments, notifications, customer portal, SLA rules |
| HR | Employee directory, manager-entered leave requests, searchable daily attendance with date, branch and status filters, scoped CSV reporting and manual monthly payroll drafts with approval, payment recording and printable internal statements | Leave balance rules, payroll rules and bank integration, overnight shifts and separate fingerprint integration |
| Accounting | Internal invoice and expense registers with filtered reports, CSV export and printable internal invoices, company chart of accounts, immutable balanced manual journals, dated reversals and scoped trial balance | Automatic document posting, periods/closing, bank reconciliation, taxes, accounts payable and receivable |
| Management | Scoped dashboard and action inbox for leave, expense and purchase drafts | Configurable approval policies, saved reports |
| POS | Branch menu, dine-in/takeaway orders with price snapshots, manual cash/card payment recording, cancellation, printable internal receipts, scoped paid-sales reports with CSV and a kitchen queue | Shifts, refunds, tax, kitchen printers, device payment, stock recipes and ledger posting |
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
- Requires both order-read access in the source scope and stock-read access in the receiving branch. Full receipts only; no valuation, payments, partial receipts or returns.

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
