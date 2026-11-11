# Release acceptance checklist

This is an uncompleted acceptance record, not a claim of approval. Scope reviewed on 8 November 2026 against the repository. See [current implementation and exclusions](RELEASE_STATUS.md) and [staging instructions](STAGING_SETUP.md). Historical CI passes do not sign off a new candidate.

## Record the candidate

- Candidate commit / deployment URL: **not recorded**
- Intended companies, branches, roles and workflows: **not agreed**
- Acceptance environment and test dataset: **not recorded**
- Business, finance and operations approvers / approval date: **pending**
- Evidence links, defects and accepted exclusions: **pending**
- Decision: **not approved for live operations by this checklist**

For each item below, record pass, fail, blocked or explicitly out of scope, with evidence, owner and date. An unchecked box means no acceptance evidence is recorded here. Out-of-scope capabilities must not be advertised or enabled as complete.

## 1. Reproducible technical checks

Use a disposable PostgreSQL database with both DATABASE_URL and DIRECT_DATABASE_URL pointing to it. Never run fixture-writing suites against production. Review the selected environment before starting commands.

- [ ] Install the lockfile with `npm ci`; generate Prisma with `npx prisma generate`.
- [ ] Apply every migration with `npm run db:deploy`; verify `npm run db:status`.
- [ ] Run `npm test`, `npm run test:db`, `npm run build` and `npm run test:api` against the exact candidate. Preserve complete results rather than a selected passing subset.
- [ ] Run `npm run lint`, `npm run typecheck` and `npm audit --audit-level=high`; record warnings separately from errors. Core checks enforces these gates for the candidate.
- [ ] Confirm the deployed application revision and database migration state match the accepted candidate. Record deployment-specific failures separately from local results.

The checked-in `.github/workflows/core.yml` defines the automated baseline. API suites exercise existing workflows, including catalog imports, private saved reports, VAT, settlements, reservations, project costs/billing/workload and payment-term templates. They are not browser, load, accessibility or statutory-compliance certification.

## 2. Access, recovery and data boundaries

- [ ] Test two tenants, multiple companies/branches and owner, restricted and suspended users. Verify direct URLs, APIs, search, totals, print and CSV cannot reveal hidden records.
- [ ] Revoke permissions during an open session and repeat reads/writes/retries; verify current authorization applies and company switches discard stale responses.
- [ ] Exercise login throttling, logout, password change/session revocation and offline recovery. Securely retain real recovery codes outside the test record.
- [ ] Keep public registration closed unless its release gates have separately passed. Verify deployment access controls and network abuse protection.
- [ ] Validate actual email delivery/recovery/verification if included in the release. These integrations remain unfinished; a restricted pilot requires an explicit approved fallback and exclusion.

## 3. Business workflow reconciliation

Use approved expected results and isolated fixtures, not demonstration records in production.

- [ ] Sales: customer/contact → quote → order → invoice → posting → collection/refund → correction. Check gross/net/tax, source balances, statements and both posting-date and due-date aging.
- [ ] Purchasing: supplier/order → partial receipts → partial returns → posting → payment/refund → correction. Reconcile source payables and physical stock, including rounding remainders.
- [ ] Tax: finance approves seller registration, effective dates, accounts, classifications and deductibility. Test saved invoice/purchase/expense/POS snapshots after profile changes. Internal VAT accounting does not establish legal eligibility or generate statutory filings.
- [ ] Ledger: reconcile balanced source/manual journals, trial balance, account statements, income statement and balance sheet. Exercise reversal dependencies and locked periods; do not infer automatic year-end closing.
- [ ] Inventory: check stock, holds, available quantity, rejected overdraws, full hold release and permanent history. Manual reservations, including explicit order links, are not physical fulfillment, automatic demand allocation, unit conversion or costing.
- [ ] Order-linked holds: verify company-level source access with separately scoped branch stock rights; source privacy in generic lists/releases; optional descriptive lines and exact stock units. Exercise order closure, item archive/unit edits, create/release UUID collisions, receipt/adjustment races and unchanged legacy holds after migration. Test two-tab pending requests, uncommitted requests after actor/unit changes with zero effects, original-unit replay after release, blocked/corrupt storage, lost responses, narrowly verified closed-order discard and selected-page CSV/print. Closing an order must not silently release or consume stock.
- [ ] Sales stock documents: reconcile explicit deliveries, partial usable returns and full corrections with immutable movements, source stock units and separate order status/invoicing. Test unreserved availability, full selected-hold atomic release/withdrawal with both permissions/audits, no hold recreation, dependent-return correction rules and no generic reversal. Exercise first-document opening offsets/history races, receipt/supplier-return/transfer/hold overlaps, closure/archive/unit changes, actor switches before first send and exact historical replay. Verify scope privacy before search/pagination/CSV, coherent concurrent rows/totals/detail/print, complete-history/group/export limits, one-connection operation, safe abandonment and delayed duplicates. Confirm migrated legacy quantities, offsets, holds, bank snapshots and request identities are unchanged.
- [ ] Branch transfers: reconcile exact paired quantities and unchanged holds, distinct same-company branches, current permissions at both ends and branch-only redaction before pagination/export. Test first-transfer opening offsets, legacy-history races, raw SQL projection/audit protection, destination overflow, receipt/return/adjustment overlaps, full correction and forbidden single-leg reversal. Verify stale actor/unit rejection, two-tab recovery, cancel-versus-save serialization and delayed requests after abandonment. Reauthorize print/CSV and refresh correction history; no transit, valuation or shipping effects are implied.
- [ ] POS: verify tax/price snapshots, gross cash/change, manual card records, kitchen progression, full/partial refunds, shift cash movement, counted closure and variance. Recording payment/refund does not move money through a device or bank.
- [ ] HR: validate attendance/leave and manual payroll approval/payment records against approved rules. Do not infer leave accrual, automatic wages, overnight shifts or bank transfer.
- [ ] Projects/helpdesk: verify task prerequisites, scoped assignments, time review/corrections, manual budget/cost reconciliation, linked invoice totals, current workload and ticket deadline history. Time does not automatically bill or cost; manual deadlines are not an SLA engine.
- [ ] CSV imports: preview invalid/duplicate records, commit a clean customer/supplier/item batch, retry an uncertain result and confirm one atomic audited batch. Imports do not overwrite records or set opening balances/stock.
- [ ] Manual subscriptions: verify independent subscription/customer scope intersection before list/search/pagination/history/exports/print/replay, Owner-only defaults and generic audit privacy. Exercise branch records referencing company-wide customers, archived sources, immutable identity/scope, abandoned-only source constraints, real calendar dates and explicit null clearing. Test version/lifecycle/retry/abandon races, actor switches across tabs, durable recovery, literal agreement text and full serialized-size boundaries. Confirm every write leaves customers, invoices, settlements, journals, VAT and stock unchanged. No billing, renewal, service change or reminder may follow from recorded dates/status.
- [ ] Internal text documents: verify company/branch visibility before search/history/CSV/download/print, Owner-only defaults for both new/existing tenants, generic audit privacy and literal text rendering. Exercise immutable versions, archive/edit/restore races, exact original receipt replay, permanent abandonment, permission revocation, actor changes, two-tab and interrupted requests, blocked storage, full escaped 64 KiB content and wire limits. Verify device-storage disclosure, current source authorization, metadata-only CSV, full selected-version output, broad provider ACL revocation, SQL projection/history/audit/delete/truncate guards and populated migration preservation. No enterprise governance or signing acceptance is implied.
- [ ] Saved reports and terms: verify private filter ownership, current permission checks, UTC as-of and month-range date modes, valid register statuses, archived presets and explicit copying of payment-term templates. Exercise old pending requests after the register-preset migration, fixed range limits, company/branch changes and stale report responses. Saved filters are not frozen results; templates do not amend existing documents.
- [ ] Payment-term amendments: verify approved replacement/clear, legacy originals, independent permissions, current read-only history and permanently retained reasons. Test concurrent edits, stale screens, uncommitted requests after another account signs in, two-tab storage races, same-request replay after interruption and void, blocked browser storage, the 1,000-event limit, in-flight revocation and a one-connection pool. Reconcile historical due-date aging before/on/after amendment UTC cutoffs without changing originals, stock, journals or financial amounts.
- [ ] Exact money: reconcile very large supported multi-record totals, a one-thousandth imbalance, currency groups and cancelling/reversal histories across all financial reports. Verify cumulative partial purchase-return VAT conserves the saved tax under the existing HALF_UP rule; do not rewrite historical records to manufacture a pass.
- [ ] Bank allocations: reconcile partial incoming/outgoing splits, both cardinalities and exact milli-unit/max amounts without changing source values. Distinguish current capacity from earlier booking-cutoff residuals and test offsetting unmatched movements. Exercise source-capacity races, cancellation/void/replacement, locked ledger periods, current company-wide permissions and a reader actually waiting behind role revocation. Verify global request UUID identity across actors/accounts/actions, durable successful correction receipts, explicit check-and-abandon, save-versus-abandon and delayed requests, blocked/legacy/corrupt storage, two tabs and account switches. Confirm old active/cancelled match metadata and saved v1 snapshot bytes/digests survive upgrade; v1/v2 display/print/download and committed old retries remain valid while stale previews fail.
- [ ] Bank snapshots: reconcile saved complete/incomplete/voided observations to exact frozen inputs and verify changed previews fail. Test company-wide read/create/manage scope, revoke access before print/download/replay, concurrent matching/journals, exact uncertain retries, uncommitted requests after another account signs in, supersede/restore version conflicts and same-account/period/currency restrictions. Verify checksum parity, payload/row limits, near-limit performance and unchanged bank/ledger source records. A checksum or reconciled status must not be described as regulatory or auditor approval.

## 4. Browser and operational acceptance

- [ ] Verify Arabic/English navigation, RTL/LTR, validation/error text, keyboard access, labels, focus, mobile widths and print/PDF output on supported browsers.
- [ ] Test double clicks, slow/offline responses, uncertain saves, reload, Close/Cancel, Back/Forward and company switching. Check exact retries create no duplicates and stale responses cannot overwrite the current screen.
- [ ] Test representative data volumes, pagination, CSV escaping, empty states and documented report caps without silent truncation. Record performance targets and measured results.
- [ ] Restore a real-format backup into an isolated environment and verify data/migrations/access. Record recovery objectives, retention, monitoring/alert ownership and rollback steps.
- [ ] Review secrets and deployment configuration without copying credentials into this record. Validate production read-only screens after rollout; no synthetic financial fixtures in production.

## 5. Decide remaining scope explicitly

- [ ] Approve financial, statutory-tax/document, HR/payroll, inventory valuation/recipes and approval policies before implementing or enabling rules that depend on them.
- [ ] Identify providers and test accounts/devices for email, payment terminals, bank feeds, fingerprint attendance, kitchen printing and any object-storage/AI integration. Unconnected services remain excluded.
- [ ] Record whether recurring subscription billing, wider document/approval workflows, AI/automation and other [remaining product development](RELEASE_STATUS.md) are required for the intended release. Preview cards are not implemented modules.
- [ ] Resolve blocking defects; name owners and target dates for accepted non-blocking exclusions. Obtain business/finance/operations sign-off for the intended scope, not an undefined claim that the whole ERP is finished.
