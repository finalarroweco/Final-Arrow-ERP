# First release readiness — 7 November 2026

Status: release candidate; not approved for general customer rollout.

## Evidence
- Baseline feature head: e45edf9f6d2a2900c6ca6836edfb7e054c284390; PR #1 remains draft and main is unchanged.
- Core checks #206 passed all 68 migrations, 28 unit checks, two database checks, production build and 25 isolated API workflows.
- The baseline Vercel deployment succeeded. Deployment evidence does not establish current runtime health or business acceptance.
- Signed-in production visual acceptance is still pending: on 7 November the cloud browser redirects `/dashboard` to `/login`. No authenticated form or report was visually accepted.
- Workload verification: Core checks #207 passed 68 migrations, 30 unit checks, two database checks, build and 26 isolated API workflows. Later navigation/typography changes require their own build/deployment result.

## Launch gates
All gates below remain open until evidence is recorded.

1. Signed-in acceptance: owner and restricted staff, company/branch switching, Arabic/English and mobile, forbidden-scope access, session/logout, core navigation and current ticket screens.
2. Account recovery: verify a real sender/domain and recovery/invitation delivery, or explicitly restrict the pilot to provisioned accounts whose offline recovery codes have already been saved and recovery rehearsed.
3. Recovery readiness: confirm backup retention and access, restore to an isolated database, record recovery duration and owner. Never restore a rehearsal over the live database.
4. Runtime operations: verify current application/database availability, configure error/availability alerts, assign incident owner and retain a rollback procedure compatible with additive migrations.
5. Business acceptance: run an agreed customer-to-invoice-to-collection and purchase-to-receipt-to-payment scenario in an isolated acceptance environment; reconcile balances, VAT snapshots and corrections. Do not create synthetic production financial records.
6. Release scope: review supported limitations with the operating team; expose only approved workflows and avoid representing internal documents as statutory tax/e-invoicing compliance.
7. Rollout: provision a limited pilot, record defects and acceptance evidence, then decide general availability. PR #1 stays draft and main is unchanged by this readiness document.

## Proposed first-release scope
Provisioned-account, multi-company/branch internal operations using existing CRM, quotations/orders, internal invoices/collections, explicit due-date terms/aging, purchases/receipts, source accounting/reports, manual stock reservations, project tasks/time/manual budgets/existing-invoice assignments and internal helpdesk.
Payroll remains manual. POS is optional and requires separate cash-handling acceptance. Email recovery is unavailable until verified; offline recovery requires previously saved codes.

## Deferred enhancements
Unallocated advances; sales-order stock allocations/valuation; payment-term catalogs/amendments; time/milestone billing generation, capacity calendars/work estimates; attachments/customer portal/configurable SLA and notifications; configurable approvals; split bank matching/frozen reconciliation; inclusive taxes; subscriptions/documents/AI/automation; hardware and external provider integrations.

These are not declared implemented or required for every limited pilot. A workflow requiring one must remain outside the pilot until delivered and accepted.

## Rollback
Retain the last accepted deployment and its commit. Before an application rollback, inspect whether its code is compatible with every already-applied migration. Published migrations are immutable; use reviewed additive fixes. Database restore is an incident recovery action, not a routine code rollback.
