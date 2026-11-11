# ERP review handoff — 11 November 2026

## Delivery boundary

This is an ongoing development review candidate, not a claim that the complete commercial ERP or its live operating environment is finished. The operating acceptance gates below are not a development freeze: missing modules continue to be implemented and independently tested using explicit operator configuration and documented safe defaults. The authorized delivery is [draft PR #2](https://github.com/finalarroweco/Final-Arrow-ERP/pull/2) on `codex/erp-release-hardening-20261108`. No merge, manual deployment or live migration is included. Use the exact head and exact-head CI links recorded in the PR when reviewing; a prior passing commit is not evidence for a later candidate.

The [current module inventory](RELEASE_STATUS.md) is authoritative. It covers implemented CRM/sales, versioned supplier RFQs with explicit DRAFT-PO selection, purchasing and physical stock workflows, source-linked accounting/settlements, explicit bank allocations and durable recovery, projects/time/manual costs and explicit approved-time DRAFT invoicing, HR/manual payroll, POS, helpdesk, internal text documents, manual agreement tracking, configured recurring DRAFT-invoice generation, configured reorder observations and multi-stage purchase/expense/leave approvals and private operational alerts with separately opted-in finite unattended DRAFT/alert jobs. Those bounded workflows do not imply statutory accounting certification, automated commercial fulfilment, automatic invoice issue/collection, activated background scheduling, enterprise document management or AI assistance.

## Decisions needed before operating a pilot

1. **Release scope and accountable approvers.** Identify intended companies, branches, roles and real workflows, plus business/finance/operations reviewers. Choose a limited pilot using implemented capabilities, or specify the additional mandatory capabilities before development continues. Do not treat every architecture vision item as an agreed release requirement.
2. **Operating rules.** Approve applicable tax/statutory documents, payroll/leave, stock valuation/recipes and approval policies for the chosen workflows. Existing manual records and optional tax snapshots do not supply those decisions. Recurring billing now accepts explicit operator-defined pricing, calendars, tax treatments and terms; users must approve those values. Unimplemented renewal/cancellation/refund authority and service rules are not inferred.
3. **Account access and providers.** Decide whether email delivery/verification/recovery is required for the pilot. A fallback using provisioned accounts, saved offline recovery codes and manually delivered invitation links needs explicit acceptance. Payment terminals, bank feeds, fingerprint attendance, kitchen printers, attachments/storage and AI services require separately selected/configured providers or devices if included. No such integration is claimed configured here. Durable automation code is implemented but requires a separately authorized dedicated server credential, enable flag and bounded scheduler setup; an enabled job alone is not a running schedule.
4. **Isolated acceptance environment.** Identify the candidate deployment and a non-production database, the authorized test accounts and dataset, and access for reviewers. Do not run fixture-writing tests or a restore rehearsal against live data. The sample-data `/erp-preview-v6.html` is separately maintained and is not acceptance of the application candidate.
5. **Rollout authority and operations.** After acceptance, explicitly approve any merge, deployment and live migration. First verify backup retention and an isolated restore, deployed revision/migration alignment, monitoring, incident ownership and rollback compatibility. Keep registration closed unless its separate gates pass.

## What technical checks establish

Exact-candidate installation, migrations, unit/component, database concurrency, API, lint, TypeScript, build and dependency checks establish the recorded isolated technical results. Populated migration tests verify preservation and rollback under the tested profiles. Independent review and simulated component tests are valuable but do not approve business policies, security configuration, production performance or real-browser use.

The final counts and verification links belong to the exact PR head. Open or blocked acceptance items remain recorded in [the acceptance checklist](RELEASE_ACCEPTANCE.md); none is implicitly approved by this handoff.

## Limited public-browser observation

On 11 November, the documented public `https://final-arrow-erp.vercel.app/dashboard` redirected to `/login`. Arabic labels/right-aligned layout switched to English/left-aligned layout and back successfully. No fields were filled, sign-in attempted, recovery started or account created. Recovery/register link destinations were observed, not exercised. The public deployment's commit is not verified, so this smoke result does not accept the exact candidate or any authenticated business flow. A supported interactive browser is available, but no candidate-to-isolated-browser path is established.

## Required interactive acceptance

Use the chosen isolated candidate with an owner and restricted/suspended users. Exercise customer-to-invoice-to-collection and purchase-to-receipt-to-payment flows; stock holds/transfers/deliveries/returns and configured shortages; bank matching, recovery and permanently abandoned requests. Reconcile expected ledger, tax, cash and stock outcomes using approved fixtures.

Test both languages, RTL/mobile, keyboard/focus, print/download/CSV, company/branch changes, permission revocation, session changes, repeated and interrupted submissions, and realistic volumes. Record pass/fail/blocked/out-of-scope with evidence and an owner. A browser redirect to login, static preview or successful API request does not establish authenticated workflow acceptance.

## Irreversible recovery safeguards

Permanent request cancellation records fence delayed requests. In particular, migration79 bank-import tombstones and insertion guards must survive application rollback after first use; dropping them can revive an old request. Migration80 reorder request identities/history and unit-generation tracking likewise require compatibility review before rollback. Keep published migrations immutable and use reviewed additive corrections. Database restore is incident recovery, not a routine application rollback.

## Next step

Continue implementing the remaining major workflows and running independent technical checks on each integrated candidate. User acceptance occurs after the intended system is implemented, while real-browser/business/operational acceptance remains necessary before live operations. Make commercial values, policies and provider choices explicit configuration; do not invent them or represent unconfigured integrations as working. Escalate only concrete consequential decisions or permissions that actually block further implementation. Merge, deployment and live migration still require separate authorization.

## Continued procurement development

Supplier RFQs connect explicit internal request revisions and supplier offers to the existing DRAFT purchase-order flow. See [the feature boundary and recovery model](SUPPLIER_RFQS.md). Final user testing is deferred until their requested development is complete; automated checks continue without treating user acceptance as a prerequisite to further engineering. No automatic supplier award, external message, issue, tax/FX calculation or stock/ledger effect is included.
