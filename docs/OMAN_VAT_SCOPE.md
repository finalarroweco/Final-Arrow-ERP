# Oman VAT implementation scope — 2026-10-08

The user selected Oman first. Current ERP invoices and purchasing/POS documents do not calculate VAT. Do not describe internal printable documents as compliant tax invoices. No live company has been marked VAT-registered or assigned a tax rate by this work.

## Verified source requirements

The Oman Tax Authority publishes a standard VAT rate of 5%, zero-rated categories and exempt activities. These treatments must remain distinct; zero-rated and exempt transactions cannot share an indistinguishable tax code. Actual classification depends on the supply, registration and applicable conditions.

Source: https://tms.taxoman.gov.om/portal/tax-rate

Full invoice/credit-note requirements must be checked against the applicable executive regulations and current official guides before implementation. Search-index excerpts referenced Articles 144/147, but their linked PDFs returned 404 during review; those excerpts are not treated as a completed statutory-field verification. Obtain the current official text first.

The Authority's published e-invoicing FAQ distinguishes standardized electronic exchange from PDFs. It lists staged rollout: selected large VAT-registered companies from August 2026, all large VAT-registered companies from February 2027, remaining VAT-registered taxpayers from August 2027, and a government phase with year unannounced. Determine whether each customer is covered rather than claiming generic compliance.

Source: https://tms.taxoman.gov.om/portal/e-invoicing-faq

## Required implementation and verification

1. Per-company registration status, tax ID, effective dates, seller legal/address details and applicable e-invoicing scope. Never infer registration from OMR currency or company location.
2. Explicit per-line treatment, taxable base, rate and tax amounts with defined inclusive/exclusive pricing, discount/freight handling and exact decimal rounding. Keep the legal treatment separate from its numeric rate.
3. Immutable invoice snapshots and gross totals. Existing non-tax documents retain their original values; later company configuration changes must not rewrite issued history.
4. Separate output/input tax accounts in source journals. Receivables, supplier balances, collections/refunds and correction caps must use the correct gross total; existing two-line assumptions and SQL triggers need coordinated additive migrations.
5. Purchase/expense input-tax eligibility, receipt returns/credits, POS taxes/refunds and document tax reporting with period locks and source permissions. Unsupported reverse charge, foreign exchange or special treatments must be explicit rather than silently approximated.
6. Full statutory invoice/credit-note fields and numbering, required format/transmission where applicable, and accountant acceptance with real operating scenarios.
7. Isolated tests for mixed treatments, inclusive/exclusive decimals, gross settlements, returns/corrections, concurrency, direct SQL guard bypass attempts and preservation of historical documents.

This document records verified requirements and implementation work still outstanding. It is not a tax engine or an assertion of legal compliance.
