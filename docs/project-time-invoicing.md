# Approved project time invoicing

This workflow turns explicitly selected, currently approved project time into a real DRAFT invoice. It does not infer billability, customers, prices, tax treatment, sales orders, milestones, subscriptions, issue authority or payment collection. A source read requires independently scoped project, project-time, project-time-invoice and customer read permissions. Generation additionally requires invoice read/create and project-billing read/manage. New capabilities default to Owner only; custom roles opt in with dependencies.

## Exact prices

Operators enter currency and nonnegative hourly rates as exact three-decimal strings and explicitly select STANDARD, ZERO or EXEMPT per record. Each selected record is one invoice line with quantity **1 time record**, not 1 hour. The description captures original hours/minutes and hourly rate. The extended amount is original minutes × exact hourly rate ÷ 60, rounded once per record HALF_UP to three decimals. No rounded per-minute rate is used. Tax follows the current invoice creation UTC date and current company VAT profile, with existing per-line HALF_UP tax rules. Snapshots retain original minutes, description, service date, approval sequence, rate, treatment, totals and invoice-date VAT revision. This does not assert statutory invoice compliance.

## Claims and corrections

Each original time entry receives one immutable permanent claim. Retry uses an actor-bound UUID and exact payload. Check-and-abandon resolves either the committed original receipt or a permanent abandonment; a new attempt cannot reuse an abandoned identity. Scope and session are rechecked after waits. PostgreSQL independently checks authorization, current approvals, exact source/line/claim/link parity and creates immutable audit records in the same transaction.

Invoice price/tax/terms corrections explicitly select the latest VOID source, same project/customer/currency and exactly the same time entitlements. Every previous financial dependency must be reversed. The new invoice remains DRAFT and links to the immutable prior source. VOID is terminal. Original requests always recover their original invoice; they never regenerate after void.

Recorded time remains immutable under the existing project-time contract. To correct recorded minutes, reverse all dependent financial journals/settlements and VOID all dependent invoices, reset the old time approval, void that time entry, then create and approve a new corrected time entry with an explicit reference in the correction reason/description. Old snapshots and claims remain retained; voided old time cannot be billed or replaced again. The new approved entry requires a new explicit selection and claim. No automatic association between unrelated records is inferred.

## Read/print and limits

Invoice registers, print/detail, posting/settlement drilldowns, project billing and customer source reports use the authoritative source-aware authorization helpers. Legacy real-order document reads retain their historical contract. Ledger totals remain complete under ledger authorization even when invoice source details are hidden. Project source links are permanent and cannot be manually reassigned/unlinked. Printing shows the one-record quantity meaning and exact snapshot line amounts. Existing authorized invoice CSV export retains exact monetary values. Selectors/history use explicit 50-row pages; a selection is limited to 100 distinct time records. No employee names/payroll rates are needed or inferred.

Automated unit, disposable database and HTTP checks are development evidence, not browser or business acceptance. No live database action, merge, deployment or customer contact is part of this change.

## Historical review authorization boundary

Existing approvals are trusted historical source records under the existing review API/backend contract. This feature does not rewrite reviews or revalidate the historical reviewer's current grants. The existing review API requires project-time:approve; its older SQL guard checks active membership, sequence and audit rather than making a historical-grant assertion. New invoice generation independently requires its current source/customer/invoice/generation grants. No DBA-proof assertion is made about pre-existing review history.

## Completed and cancelled projects

Already-approved, previously unbilled time may be explicitly invoiced after project completion without reopening the project or creating/reviewing time. Fresh billing on CANCELLED projects is blocked. Explicit financial corrections of existing time entitlements are allowed after COMPLETED or CANCELLED, with the same time entries/claims and all prior VOID/reversal checks. Generated source links receive only this narrow exception; arbitrary manual invoice linking remains restricted to operationally open projects. Operational time corrections still follow the existing open-project review/void rules and do not reopen completed/cancelled work.

Project billing reports count DRAFT, ISSUED and VOID links separately. Drafts are visible in history but do not contribute to issued/posted/collected totals. Generated time source links cannot be manually detached or reassigned.

## Shared service-source terminality

Migration85 also closes one trusted-backend status gap for existing recurring service invoices: once VOID, they cannot return to DRAFT or ISSUED, before or after an explicit replacement. This matches their existing API rule, keeps original receipts/history, and prevents reactivating an original entitlement alongside its replacement. Published migration82 and legacy real-order status behavior remain unchanged. This is additive trusted-backend hardening, not a claim of an exposed API bug or DBA-proof enforcement.
