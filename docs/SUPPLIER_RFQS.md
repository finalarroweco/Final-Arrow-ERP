# Supplier requests for quotation and offer selection

## Purpose and operating boundary

The bilingual procurement workspace connects an internal request for quotation (RFQ), operator-recorded supplier offers and an explicitly selected offer to the existing purchase-order lifecycle. Opening an RFQ means it is open for internal offer recording. It is not evidence that a supplier was contacted or that an email was sent.

The operator supplies request descriptions, integer quantities, deadline dates, offer values, validity dates, selection reason and purchase-order number. No prices, commercial commitments, taxes, exchange rates, supplier choices or contractual acceptance are inferred. Offer amounts are net prices in the company's base currency, represented exactly to three decimals. An award creates a **DRAFT** purchase order only. Existing issue, receipt, stock and accounting steps remain separate operations with their own permissions.

The first supported procurement path selects one complete offer for the whole RFQ into one purchase order. Split awards, line-by-line supplier allocation, mixed currencies, currency conversion, delivery schedules, freight/discount allocation, tax calculation, external supplier portals, email and notifications are not implemented. Recording or selecting an offer does not claim that a supplier has accepted any order.

## Review and comparison

Request revisions and supplier-offer revisions preserve what was recorded at the time. Offers refer to an exact RFQ revision; editing either a draft or open request returns it to DRAFT, increments its specification revision and marks earlier offers stale. Reopen explicitly before recording revised offers. Changing a request does not silently reprice or reinterpret an older offer. Every action also increments the RFQ concurrency version, so a competing offer write requires a refresh rather than silently overwriting another update. Incomplete offers remain visible and must not be treated as complete totals or winners. Expired offers remain reviewable but are not eligible for a new award. A low price is information, not an automatic award recommendation.

Comparison is same-currency net-price information only. Missing lines, stale request revisions, current source availability and offer validity must be reviewed before selection. Dates are real calendar dates explicitly entered by the operator. The request deadline is informational; it does not infer a supplier commitment or automatically close the request. An omitted validity date is shown as unknown and may be explicitly accepted by the operator when awarding a complete offer. Expiry evaluation uses the later of the operator's evaluation date and the server's current UTC date, so backdating cannot revive an expired offer. Pagination and observation timestamps describe the current observation, not a historical all-pages snapshot. An export of a page is not a complete export of every request, offer or revision.

## Identity, permissions and recovery

Current tenant/company/optional-branch authorization is checked independently for RFQ access, supplier visibility and purchase-order creation. Grant scopes must cover the same operation; a grant in one branch cannot satisfy a different branch's required permission. New RFQ permissions default to Owner only. Current authorization also governs retries, history, reads and exports.

Every attempted mutation has an actor-bound request identity, original scope, exact payload and optimistic version. A response loss does not authorize a replacement purchase order or a new request. Exact retries recover the original terminal receipt. Check-and-abandon records an irreversible fence for a request that has not committed; it does not cancel an RFQ revision or an already created purchase order. Keep durable request identities and cancellation records when rolling an application version back.

The browser retains pending mutation data in unencrypted actor/scope-specific local storage for recovery. Unsent drafts stay in memory. Access loss clears rendered private data without silently discarding pending requests. Cross-tab locking and mounted read epochs prevent delayed callbacks from replacing a newer scoped observation or reviving cleared supplier information. Recovery requires a verified exact terminal result before clearing the saved request.

Immutable snapshots retain original supplier names losslessly, including legacy names accepted by the database. New-entry validation must not reinterpret historical source text. Generic audit metadata does not expose supplier pricing, private offer text or selection reasons. Detailed records are available through the currently authorized RFQ workflow.

## Database and release limits

Migration 81 is additive and transactional. The preceding 80 migrations remain unchanged. The migration must not manufacture RFQs, offers, awards, purchase orders, stock or financial records. Immutable request/offer history and atomic purchase-order linkage protect the trusted application write path, not a database administrator capable of disabling schema guards.

The exact candidate requires fresh migration, unit/component, direct database, API concurrency, pool-size, lint, TypeScript, build and dependency checks. A populated 80→81 upgrade must preserve old rows and snapshots, including row versions except for explicitly added permission records. Check atomic invisibility before commit, rollback after a late migration error and both vanilla PostgreSQL and optional provider-role privilege profiles.

Real-browser, accessibility, Arabic typography, business, security and operational acceptance are separate and are not claimed by automated tests. No live migration, deployment, external supplier communication or assertion that the complete ERP is finished is included in this feature.
