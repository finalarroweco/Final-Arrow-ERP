# Oman VAT implementation scope — 2026-10-08

The user selected Oman first. The first implemented slice calculates VAT on internal sales invoices for explicitly registered OMR companies. Purchasing, expenses and POS do not calculate VAT. Do not describe internal printable documents as compliant tax invoices. No live company has been marked VAT-registered or assigned a tax rate by this work.

## Verified source requirements

The Oman Tax Authority publishes a standard VAT rate of 5%, zero-rated categories and exempt activities. These treatments must remain distinct; zero-rated and exempt transactions cannot share an indistinguishable tax code. Actual classification depends on the supply, registration and applicable conditions.

Source: https://tms.taxoman.gov.om/portal/tax-rate

Full invoice/credit-note requirements must be checked against the applicable executive regulations and current official guides before implementation. Search-index excerpts referenced Articles 144/147, but their linked PDFs returned 404 during review; those excerpts are not treated as a completed statutory-field verification. Obtain the current official text first.

The Authority's published e-invoicing FAQ distinguishes standardized electronic exchange from PDFs. It lists staged rollout: selected large VAT-registered companies from August 2026, all large VAT-registered companies from February 2027, remaining VAT-registered taxpayers from August 2027, and a government phase with year unannounced. Determine whether each customer is covered rather than claiming generic compliance.

Source: https://tms.taxoman.gov.om/portal/e-invoicing-faq

## Implemented invoice slice

- Company-wide company-update and ledger-read permissions control registration settings: seller tax ID, legal name/address, effective date and output VAT liability account. OMR is required; no live registration is inferred or enabled automatically. Revision checks serialize competing saves with invoice creation.
- Prices from sales orders are VAT-exclusive. Every line explicitly selects STANDARD (5%), ZERO (0%) or EXEMPT (0%). Decimal tax rounds per line to three places, half up, then sums. There are no inclusive prices, discounts, freight, currency conversion or reverse-charge calculations.
- Invoice creation saves immutable seller, account and per-line treatment/net/tax snapshots in the original transaction. Existing invoices retain their original non-tax amounts. Later settings changes affect future invoices only.
- Posting debits gross receivable, credits net revenue, and separately credits the saved output VAT liability when positive. Zero/exempt-only invoices preserve two journal lines while retaining distinct treatments. Collections, refunds, correction caps, customer statements and invoice-register JSON/CSV use gross totals; recognized revenue remains net.
- Internal print/PDF shows saved seller details, classifications, net, tax and gross. It is not a statutory electronic invoice, credit note, return filing or claim of legal compliance.
- Isolated API/database tests cover mixed classification, line rounding, immutable history, direct SQL invalid snapshots, registration concurrency, authorization, gross settlement/refund dependencies and zero/future-date handling. Live QA reads settings without creating financial fixtures or configuring registration.

## Remaining implementation and verification

1. Verify each company’s actual registration data and applicable e-invoicing scope. The invoice profile fields exist; registration data must be supplied by the company. Never infer registration from OMR currency or company location.
2. Extend beyond the implemented VAT-exclusive invoice lines to inclusive pricing and discount/freight handling when agreed. Keep the legal treatment separate from its numeric rate.
3. Extend immutable gross snapshots to remaining document families. Invoice snapshots and gross totals are implemented. Existing non-tax documents retain their original values; later company configuration changes must not rewrite issued history.
4. Extend from the implemented invoice output VAT account to purchase/expense input VAT accounts. Receivables, supplier balances, collections/refunds and correction caps must use the correct gross total; existing two-line assumptions and SQL triggers need coordinated additive migrations.
5. Purchase/expense input-tax eligibility, receipt returns/credits, POS taxes/refunds and document tax reporting with period locks and source permissions. Unsupported reverse charge, foreign exchange or special treatments must be explicit rather than silently approximated.
6. Full statutory invoice/credit-note fields and numbering, required format/transmission where applicable, and accountant acceptance with real operating scenarios.
7. Isolated tests for mixed treatments, inclusive/exclusive decimals, gross settlements, returns/corrections, concurrency, direct SQL guard bypass attempts and preservation of historical documents.

This document distinguishes the implemented internal invoice slice from remaining work. It is not an assertion of legal compliance.
