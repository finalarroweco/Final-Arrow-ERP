# Physical sales stock documents

This workflow records goods already delivered or restored to usable stock. Open a sales order and choose **Physical deliveries and returns**. It does not arrange shipping, allocate commercial demand, complete an order, create an invoice, refund, credit, journal, valuation or tax entry.

## Operator choices

- A delivery records one explicitly selected item, stock branch and positive quantity in its displayed stock unit (0.001 to 999999999.999). An optional sales line is descriptive. Sales line quantities are commercial integers with no stock-item/unit mapping; there is no inferred conversion, demand cap or fulfilment percentage.
- Delivery is allowed for NEW, IN_PROGRESS and COMPLETED orders, never CANCELLED. A branch-owned order must use its own stock branch. Company-wide orders require company-wide source access and may use a separately authorized stock branch.
- **Unreserved stock** withdraws no more than physical minus reserved quantity and leaves all holds untouched.
- **Entire selected order hold** is an explicit alternative. Select exactly one active order-linked hold. The whole original quantity is released and withdrawn in one transaction; item, unit, branch, source and optional line must match. No automatic selection or partial hold consumption occurs. Previously released holds cannot be used. Both delivery-management and reservation-management rights are necessary.
- Confirm that the physical movement occurred. Time is the database's current recording time; backdating is not supported.

## Usable returns and record corrections

A partial usable-stock return references an original delivery and restores only its item, original unit and original branch. Confirm the goods are usable. Damaged/quarantined goods, cross-branch returns, replacements and financial refunds are outside this workflow. The sum of effective returns cannot exceed the original delivery.

A full correction is a separate, opposite stock event. An original delivery can be corrected once only after correcting any effective dependent returns. Correcting a return withdraws the original full quantity, requires unreserved availability and restores returnable capacity. A correction cannot itself be corrected. All original events remain visible.

Returns and corrections remain available after order completion/cancellation. They never recreate holds, including when the original delivery used a hold. New deliveries require active items; returns/corrections may reference archived items. Current stock unit must equal the original document unit. Editing a catalog unit does not convert historical or current stock quantities.

## Access and history

`order-delivery:manage` defaults to Owner only. Writes also require order read at source scope and stock read/adjust at the actual branch. Full-hold deliveries additionally require `order-reservation:manage`. Reads, register filters, totals, exports and print require both source and stock read. Access is checked again for every retry and request-abandonment operation.

Each document has immutable database-generated source/item/unit/branch/actor snapshots, timestamp, exact movement and same-transaction audit. Source identity and linked lines cannot be rewritten. Generic stock pages show only the local quantity and a generic movement label, never private sales references or customer/order links. Generic stock reversal cannot reverse these movements. Private document identifiers are excluded from the general audit list; use the authorized sales-stock register.

Source register and detail reads hold the order stable after fresh authorization, so concurrent writes cannot mix the printed history or reported totals. Complete detail/print rejects histories above 5000 returns or return corrections instead of silently truncating them; use the filtered register for those histories. Register totals reject more than 5000 item/unit/kind groups and exports reject more than 5000 documents, with narrower filters required. These are read limits, never limits on legitimate future stock returns or corrections.

Totals are separated by original branch, item and historical unit, with deliveries, returns, delivery corrections and return corrections distinct. Generic stock reports remain based on recorded movements. A pre-existing undated balance difference is preserved as an immutable opening offset and disclosed, not fabricated into dated history.

## Safe retry and recovery

The browser saves the exact actor, order, unit, action and request UUID before sending. Web Locks and cross-tab storage checks prevent an unrelated new submission from replacing an unresolved request. Network errors, denied access, stale units and malformed responses retain the original request.

Use **Retry exact saved request** to recover a recorded result. A valid original request returns its immutable result even after permitted lifecycle, item archive or unit changes, provided current access remains. **Check and abandon request** returns an already recorded matching result or saves a permanent audited tombstone, preventing a delayed request from writing later. It never reverses saved stock or releases an active hold. Do not manually delete unresolved storage to retry a business action with a new UUID.

Printing refreshes authorization and document/correction history immediately before rendering. Unsupported browser storage/locking disables new mutations rather than weakening recovery.

## Verification boundary

Tests use disposable loopback PostgreSQL fixtures, never live stock/financial records. Unit/component simulations cover storage and actor/source changes, concurrent tabs, unknown outcomes and print revocation. Real browser execution remains separately blocked by the execution environment's Chromium Unix-socket limitation; simulated component checks are not a browser pass. No production deployment or external fulfilment provider is configured by this feature.
