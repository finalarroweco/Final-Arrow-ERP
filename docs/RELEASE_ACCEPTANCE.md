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
- [ ] Inventory: check stock, holds, available quantity, rejected overdraws, full hold release and permanent history. Manual reservations are not sales allocation, costing or fulfillment.
- [ ] POS: verify tax/price snapshots, gross cash/change, manual card records, kitchen progression, full/partial refunds, shift cash movement, counted closure and variance. Recording payment/refund does not move money through a device or bank.
- [ ] HR: validate attendance/leave and manual payroll approval/payment records against approved rules. Do not infer leave accrual, automatic wages, overnight shifts or bank transfer.
- [ ] Projects/helpdesk: verify task prerequisites, scoped assignments, time review/corrections, manual budget/cost reconciliation, linked invoice totals, current workload and ticket deadline history. Time does not automatically bill or cost; manual deadlines are not an SLA engine.
- [ ] CSV imports: preview invalid/duplicate records, commit a clean customer/supplier/item batch, retry an uncertain result and confirm one atomic audited batch. Imports do not overwrite records or set opening balances/stock.
- [ ] Saved reports and terms: verify private filter ownership, current permission checks, UTC as-of and month-range date modes, valid register statuses, archived presets and explicit copying of payment-term templates. Exercise old pending requests after the register-preset migration, fixed range limits, company/branch changes and stale report responses. Saved filters are not frozen results; templates do not amend existing documents.

## 4. Browser and operational acceptance

- [ ] Verify Arabic/English navigation, RTL/LTR, validation/error text, keyboard access, labels, focus, mobile widths and print/PDF output on supported browsers.
- [ ] Test double clicks, slow/offline responses, uncertain saves, reload, Close/Cancel, Back/Forward and company switching. Check exact retries create no duplicates and stale responses cannot overwrite the current screen.
- [ ] Test representative data volumes, pagination, CSV escaping, empty states and documented report caps without silent truncation. Record performance targets and measured results.
- [ ] Restore a real-format backup into an isolated environment and verify data/migrations/access. Record recovery objectives, retention, monitoring/alert ownership and rollback steps.
- [ ] Review secrets and deployment configuration without copying credentials into this record. Validate production read-only screens after rollout; no synthetic financial fixtures in production.

## 5. Decide remaining scope explicitly

- [ ] Approve financial, statutory-tax/document, HR/payroll, inventory valuation/recipes and approval policies before implementing or enabling rules that depend on them.
- [ ] Identify providers and test accounts/devices for email, payment terminals, bank feeds, fingerprint attendance, kitchen printing and any object-storage/AI integration. Unconnected services remain excluded.
- [ ] Record whether subscriptions, documents, AI/automation and other [remaining product development](RELEASE_STATUS.md) are required for the intended release. Preview cards are not implemented modules.
- [ ] Resolve blocking defects; name owners and target dates for accepted non-blocking exclusions. Obtain business/finance/operations sign-off for the intended scope, not an undefined claim that the whole ERP is finished.
