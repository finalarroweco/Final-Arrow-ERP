# ERP review handoff — 11 November 2026

## Delivery boundary

This is a review candidate, not a claim that the complete commercial ERP or its live operating environment is finished. The authorized delivery is [draft PR #2](https://github.com/finalarroweco/Final-Arrow-ERP/pull/2) on `codex/erp-release-hardening-20261108`. No merge, manual deployment or live migration is included. Use the exact head and exact-head CI links recorded in the PR when reviewing; a prior passing commit is not evidence for a later candidate.

The [current module inventory](RELEASE_STATUS.md) is authoritative. It covers implemented CRM/sales, purchasing and physical stock workflows, source-linked accounting/settlements, explicit bank allocations and durable recovery, projects/time/manual costs, HR/manual payroll, POS, helpdesk, internal text documents, manual agreement tracking and configured reorder observations. Those bounded workflows do not imply statutory accounting certification, automated commercial fulfilment, recurring billing, enterprise document management or AI automation.

## Decisions needed before operating a pilot

1. **Release scope and accountable approvers.** Identify intended companies, branches, roles and real workflows, plus business/finance/operations reviewers. Choose a limited pilot using implemented capabilities, or specify the additional mandatory capabilities before development continues. Do not treat every architecture vision item as an agreed release requirement.
2. **Operating rules.** Approve applicable tax/statutory documents, payroll/leave, stock valuation/recipes and approval policies for the chosen workflows. Existing manual records and optional tax snapshots do not supply those decisions. Recurring billing additionally needs pricing, calendars, renewal/cancellation/refund authority and service rules.
3. **Account access and providers.** Decide whether email delivery/verification/recovery is required for the pilot. A fallback using provisioned accounts, saved offline recovery codes and manually delivered invitation links needs explicit acceptance. Payment terminals, bank feeds, fingerprint attendance, kitchen printers, attachments/storage and AI services require separately selected/configured providers or devices if included. No such integration is claimed configured here.
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

Complete the candidate's independent technical checks, review the exact draft head, then agree the limited release scope and isolated acceptance environment. Record real-browser/business/operational evidence before requesting rollout approval. Work requiring undecided policies or new provider access remains explicitly pending rather than being replaced by arbitrary manual features.
