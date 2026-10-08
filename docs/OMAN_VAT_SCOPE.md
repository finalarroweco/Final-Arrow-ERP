# Oman VAT implementation scope — 2026-10-08

The user selected Oman first. The implemented slices calculate output VAT on internal sales invoices and POS orders, and input VAT at purchase receipt/return and expense journal posting for explicitly registered OMR companies. Do not describe internal printable documents as compliant tax invoices. No live company has been marked VAT-registered or assigned a tax rate by this work.

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

## Implemented purchase accounting slice

- VAT settings optionally select a scoped ASSET input-tax account; deductible tax requires this account, separate from cost and supplier payable. Existing sales-only settings remain compatible.
- At receipt journal posting, each received line explicitly selects standard 5% deductible, standard 5% non-deductible, zero, exempt or no VAT charged. Supplier invoice reference is required; standard tax requires the supplier VAT number. Eligibility is a user decision based on the actual supplier document, not an automatic legal determination.
- Immutable journal-linked snapshots preserve supplier identity, reference, line quantities, treatment, net/tax and recoverability. Recoverable VAT debits input tax; non-recoverable tax adds to the purchase cost; supplier payable and payments/refunds/statements use gross. Stock quantities and purchase order net prices retain their existing meaning.
- Return posting requires an active original receipt journal and supplier credit-note reference. It retains original tax treatments and input account even after settings change. Receipt source locking serializes return postings; cumulative rounded proportional allocation distributes each line's saved tax exactly, including rounding remainders and earlier reversed credit snapshots. Physical return quantities remain authoritative.
- Database guards enforce snapshots in the journal's original transaction, exact source numbers, required source audits, scoped accounts, amounts and immutable records. Period locks and settlement/reversal dependencies apply. Previously posted non-tax receipt journals remain unchanged.
- VAT-exclusive OMR domestic accounting only: no inclusive pricing, imports/reverse charge, partial recovery percentages, tax-return filing or statutory supplier tax-document generation. Internal print displays saved financial VAT separately from the original stock receipt/return.

## Implemented expense accounting slice

- Each internal expense has one VAT-exclusive amount. At journal posting, an effective enabled OMR profile requires explicit standard deductible/non-deductible, zero, exempt or no-tax classification, supplier invoice name/reference and supplier VAT number for standard tax. Deductibility is a manual decision based on the actual supplier invoice; mixed treatments within one expense, imports, reverse charge, inclusive pricing and fractional recovery are unsupported.
- Immutable same-transaction snapshots preserve net/tax/recoverable tax, supplier details, classification and the input account. Posting debits expense cost (net plus non-deductible VAT), credits gross cash/bank or liability and separately debits recoverable input VAT. Zero rounded tax uses two journal lines. No money is transferred.
- Register cards separate net, saved VAT, deductible VAT, gross and expense cost. Report/category totals and dashboard posted expenses use net plus non-deductible VAT. CSV separates cost, net, tax, deductible tax and gross. This remains a document-status register, not a tax return or ledger report: reversed journals do not automatically change register status/totals; void the source after its reversal when appropriate.
- Financial source fields and snapshots cannot be changed or appended later. A source with a VAT snapshot cannot reopen after posting; void requires reversing its original journal first. Reversal copies all original lines including the original input account and preserves the snapshot even after company settings change. Source expense-read and ledger-read/post permissions and period locks apply.
- Previously posted non-tax expense journals remain unchanged. Actual company registration is never inferred or enabled as part of QA. Statutory supplier tax invoices/credit notes, expense payment allocation/refund workflows and filing are separate remaining work.

## Implemented POS accounting slice

- Effective enabled OMR registration requires STANDARD (5%), ZERO or EXEMPT explicitly for every order line at creation. Menu prices exclude VAT. Tax rounds each line half up to three decimals, then sums; cash/card settlement uses the saved gross total and cash change is tendered minus gross. Card recording is manual and never captures a payment.
- Company locking serializes profile saves with order creation. Original-transaction immutable snapshots preserve seller details, output account and each line's net/treatment/tax. Price, name or registration changes cannot rewrite saved orders. Existing non-tax orders remain unchanged; late line/snapshot inserts are rejected.
- Paid orders post once: gross cash/bank asset debit, net revenue credit and saved output liability credit for positive tax. Zero-tax classifications retain separate detail with two journal lines. Source-linked audit, exact amounts/accounts, company/branch permissions and period locks are database/server enforced. Reversal retains all original accounts and tax; it requires POS source-read and ledger-read/post and does not refund money or change the paid-order status.
- POS cards and internal receipts display saved net, tax and gross. Receipt print displays saved seller and per-line classification. Paid-date JSON/CSV reports separate net and tax while retaining gross sales/cash/change. Reports remain a paid-order register and do not subtract journal reversals or represent cash refunds.
- Isolated CI covers mixed/zero/exempt rounding, future and disabled profiles, required explicit choices, immutable and late/invalid snapshots, gross tendered/change, concurrent pay/cancel and postings, saved-account reversal, source/branch permissions, report/receipt output and period locks. No production orders, VAT settings or financial QA fixtures are created.

## Implemented full POS refund recording

- Records a full-order refund already performed, including saved output VAT, on the original sale's cash/bank, revenue and VAT liability accounts. It does not transfer funds, call a terminal, restore stock or issue a statutory credit note. Partial/line-specific refunds and a different refund asset account are unsupported.
- Requires a PAID order with an active original POS sale journal. Exact UUID retry IDs retain immutable reference/reason/date and amounts; changing a retry's payload is rejected. One active full refund per order is allowed under the source lock. After reversing an incorrect refund, a new UUID can record a genuine replacement; replay of the old UUID always returns the original record.
- POS-read, POS-manage and ledger-read/post are required to record or reverse a refund. Viewing history/reports requires POS-read and ledger-read. Branch scopes and period locks apply. Refund/correction dates cannot precede later source accounting activity; the original sale cannot reverse while an active refund exists. Database guards additionally enforce same-transaction source/audit, exact opposite original lines and audited exact corrections.
- A refund does not change the immutable PAID order or original paid-date sales register. The separate refund register uses UTC journal dates and current reversal status, with net/tax/gross active totals and reversed counts/gross. It is not a historical balance, net sales report or tax return. CSV retains all matching source records, references and correction status. Original receipt print shows recent refund history without altering the original amounts.
- Tests run only against isolated CI PostgreSQL. Production QA reads the empty real report and never records a refund or creates test sales.

## Remaining implementation and verification

1. Verify each company’s actual registration data and applicable e-invoicing scope. The invoice profile fields exist; registration data must be supplied by the company. Never infer registration from OMR currency or company location.
2. Extend beyond the implemented VAT-exclusive invoice lines to inclusive pricing and discount/freight handling when agreed. Keep the legal treatment separate from its numeric rate.
3. Extend immutable gross snapshots to remaining document families. Invoice snapshots and gross totals are implemented. Existing non-tax documents retain their original values; later company configuration changes must not rewrite issued history.
4. Extend from implemented invoice/POS output and purchase/expense input VAT accounting to agreed remaining workflows. Preserve gross settlements and correction dependencies through additive migrations.
5. Obtain accountant acceptance for manual purchase eligibility and receipt/return allocations. Review manual expense input-tax eligibility; extend full POS refunds to partial returns and document tax reporting with period locks and source permissions. Unsupported reverse charge, foreign exchange or special treatments must be explicit rather than silently approximated.
6. Full statutory invoice/credit-note fields and numbering, required format/transmission where applicable, and accountant acceptance with real operating scenarios.
7. Isolated tests for mixed treatments, inclusive/exclusive decimals, gross settlements, returns/corrections, concurrency, direct SQL guard bypass attempts and preservation of historical documents.

This document distinguishes the implemented internal invoice, POS, purchase and expense accounting slices from remaining work. It is not an assertion of legal compliance.
