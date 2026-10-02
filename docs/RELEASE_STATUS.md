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
