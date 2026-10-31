# First release readiness — 31 October 2026

Status: release candidate; not approved for general customer rollout.

## Evidence
- Audited feature head: 07e18d5b12c9510a5b32463a2949714696405478.
- Core checks #190 passed 62 migrations, 21 unit checks, two database checks, build and 22 isolated API workflows on 19 October.
- GitHub Vercel commit status remains success when checked 31 October. This is deployment evidence, not a current runtime-health or business acceptance certificate.
- No application changes since that head were found in PR #1.
- Signed-in production visual acceptance has not been completed for the latest deadline screens.

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
Provisioned-account, multi-company/branch internal operations using existing CRM, quotations/orders, internal invoices/collections, purchases/receipts, source accounting/reports, project tasks/time and internal helpdesk.
Payroll remains manual. POS is optional and requires separate cash-handling acceptance. Email recovery is unavailable until verified; offline recovery requires previously saved codes.

## Deferred enhancements
Due-date payment terms and overdue aging; unallocated advances; inventory reservations/valuation; project budgets/billing/resource planning; attachments/customer portal/configurable SLA and notifications; configurable approvals; split bank matching/frozen reconciliation; inclusive taxes; subscriptions/documents/AI/automation; hardware and external provider integrations.

These are not declared implemented or required for every limited pilot. A workflow requiring one must remain outside the pilot until delivered and accepted.

## Rollback
Retain the last accepted deployment and its commit. Before an application rollback, inspect whether its code is compatible with every already-applied migration. Published migrations are immutable; use reviewed additive fixes. Database restore is an incident recovery action, not a routine code rollback.
