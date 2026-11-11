# Recurring billing operator workspace

Open **Accounting → Recurring billing** from the workspace, dashboard launcher or report directory. Arabic and English labels are available. This workflow creates genuine **DRAFT invoices**, not sales orders. Issue, posting, collection, reversal and void remain separately authorized existing invoice actions. There is no live scheduler, service activation/suspension, renewal, charge or provider integration.

## Operator configuration

1. Choose an authorized company/branch scope. Billing read/manage/generate permissions are separate from the manual subscription register permissions. Customer and invoice access are checked independently.
2. Create a price plan with an explicit currency, descriptions, positive integer quantities, exact three-decimal price strings and a tax treatment for every line. The UI does not guess a price or tax classification. Each save creates an immutable revision; archive conservatively blocks new generation.
3. Create a billing subscription with a customer, optional manual-record navigation link, original UTC date anchor and cadence. These identity fields and currency cannot be changed later. Choose monthly original-day clamp or month-end, annual February 29 handling, or a fixed day interval. Month-end anchors must themselves be month-end. The default form billing state is paused, not active service.
4. Select the exact plan revision, effective ungenerated period index, a finite authorized horizon, billing state and explicit payment terms. Payment terms are none or a copied label/day offset based on period start or the exclusive period end. Preview shows the resulting due date. No partial-period proration is performed.
5. Preview the calendar. It displays up to 25 periods per page with per-period eligibility, exact currency amounts, tax, due date and plan revision. Use pagination to inspect the remaining finite horizon. Generation is an explicit individual action for each eligible period with an audit reason. Past periods need explicit backfill mode. There is no one-click unbounded catch-up.
6. Open each generated invoice to review and perform any separately authorized issue, posting or collection. A repeated period never implies a second entitlement. An already generated/voided invoice is not automatically regenerated.

## Corrections and history

First follow the existing invoice reversal/void prerequisites. On the latest voided period source choose a linked replacement, explicitly select a replacement plan revision, enter the reason and refresh preview. A replacement receives a new invoice number while preserving the original period/correction relationship. Historical invoice lines are never edited. An already-generated PAUSED or ENDED backfilled entitlement can be explicitly corrected without changing its billing state. It still requires the latest prior invoice to be VOID, every posting/settlement dependency reversed, current financial access, the original finite period, and nonarchived sources; repeating the correction cannot create another invoice.

Register cards show only recent revisions/sources. **Full paginated history** traverses immutable plan revisions, configuration revisions and invoice sources in 50-row pages. Older plan versions can be added to the explicit revision selectors from history. Print and CSV export contain the currently displayed history page only, and are labelled accordingly. There is no combined cross-currency total.

## Interrupted requests

Before transmission the exact actor/scope-bound request is saved in browser storage. Web Locks prevent concurrent tabs from replacing it. Lost responses and HTTP errors keep that exact request pending. Use **Retry exact request** or **Check and abandon if uncommitted**. The latter may recover a committed result instead of cancelling it. A verified terminal receipt is required before local recovery state is removed. Unsupported storage/locking, malformed captures, account changes and revoked permissions block further writes rather than silently discarding the request. Unsaved form edits are not preserved across scope changes or navigation.

Browser acceptance is separate from the automated controller tests. The workspace does not claim that a live scheduler or external payment flow has been configured.

## Configuration limits

- Supported UTC dates are 2000-01-01 through 2099-12-31; the complete period and resulting due date must fit that range. Monthly intervals are 1–120 months, annual intervals 1–10 years, and day intervals 1–3660 days.
- Plans contain 1–500 lines with positive integer quantities. Monetary amounts are exact NUMERIC(18,3) values; any line, subtotal, tax or gross overflow is rejected. Current Oman VAT requires OMR and uses the existing current creation-date profile, with 5% STANDARD HALF_UP per line and separate ZERO/EXEMPT treatments.
- Future service periods cannot be invoiced in advance. Current periods require normal generation; completed past periods require explicit backfill. Explicit backfill may cover a previously paused/ended full period only within its finite configured horizon and with a recorded reason. It does not change service state.
- Configuration revisions cannot alter a generated period or precede the latest effective configuration boundary. Corrections use a selected replacement plan revision and retain the original entitlement identity; original posting and settlement reversal prerequisites still apply.
- The register pages plans and subscriptions in groups of 50, showing the latest configuration and up to 10 recent invoice sources. The authorized customer selector is bounded to 5000 records and rejects larger results rather than silently truncating. Large histories use explicit 50-row pagination.

- Every request also has an aggregate limit of **1,200,000 UTF-8 bytes of canonical JSON**, including all fields and line text. The per-field/500-line limits do not override this combined cap. The UI checks it before saving a pending request or transmitting; reduce text/line count if the request is too large. The server independently reads the body through a bounded stream. Under-cap captures retain exact retry/terminal-abandon recovery; malformed or tampered captures remain blocked.
- Existing ledger posting requires document currency to match company base currency. There is no implicit exchange-rate conversion; a differently denominated draft does not bypass that guard.
