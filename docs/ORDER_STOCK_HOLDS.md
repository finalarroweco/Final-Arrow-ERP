# Order-linked manual stock holds

This is manual reservation recordkeeping, **not physical sales fulfilment**.
Operators explicitly select an order, stock branch, item and positive stock-unit quantity. An optional sales-line identity is a descriptive association only. No SKU inference, sales-unit conversion, demand cap/progress, allocation priority, expiry, dispatch, valuation, invoice or ledger effect is implied.

Only NEW/IN_PROGRESS orders accept new holds. Completing/cancelling an order and issuing its whole-order invoice remain independent. Existing holds remain active until an explicit full release with reason, including after order closure or item archive. Quantity corrections require full release and a new hold. Existing lifetime limit remains 5,000 reservations per balance.

## Authorization and privacy

- Reading linked history requires current `order:read` at the **source order scope** and `inventory-stock:read` at the **actual stock branch**.
- Creating/releasing/replaying requires those reads plus `order-reservation:manage` at source scope and `inventory-stock:adjust` at the stock branch. `order:manage` alone is deliberately insufficient.
- The new explicit permission is assigned to Owner only, for both upgraded and newly registered tenants. Custom roles can receive it with `order:read` alone at source scope; grant stock read/adjust independently at the permitted stock branch, rather than broadening a company-wide source role to company-wide inventory visibility. Default Manager/Viewer behavior for unlinked stock holds is unchanged.
- A branch-only grant never confers access to a company-wide source order. Company-wide sources still require an explicit stock branch.
- Generic inventory reservation lists exclude linked holds before pagination, so they expose no linked references, notes, customer identities or record counts. Total reserved stock remains the ordinary stock balance projection. Generic release is subject to the same joint source authorization.
- Private source labels/notes are not copied into generic stock reference/audit text. Structured source audits retain source identity and release reason.

## Integrity and concurrency

`StockReservation.sourceKind` defaults to MANUAL for all existing history. ORDER_MANUAL rows and their immutable scoped association must be created in the same transaction. Historical unlinked holds cannot be reclassified or retroactively attached. Composite foreign keys bind reservation, balance, item, tenant, company, branch, order and optional line. Database triggers derive snapshots and timestamps, enforce active-source creation and current permissions, reject history rewrites/deletion, and require same-transaction reservation and source audits. Both tables remain server-only with RLS and public/anon/authenticated grants revoked.

Linked creation lock order is Tenant SHARE, request-UUID advisory lock, InventoryItem SHARE, StockBalance UPDATE, SalesOrder UPDATE, optional source line SHARE. The early database trigger acquires item before the existing reservation balance trigger, including direct SQL. This matches purchase receipt item-before-sorted-balance locking. Stock-only reservation and linked release paths retain balance-before-order and never acquire an item lock. Status/invoice paths never acquire a balance or item. Permission/team editors use Tenant UPDATE; service authorization always uses the same transaction client. The endpoint changes one hold at a time, not a partially committed multi-line batch.

Every linked reserve request includes the explicitly displayed `expectedUnit`. The service checks it against the locked item, and the database rejects a differing supplied unit before deriving snapshots. A stale form cannot silently reinterpret a stock quantity. Exact replay compares the original hold unit, so it still succeeds after release and a later permitted catalog-unit change.

Original item/name/unit and source labels are permanent snapshots. Unit edits are rejected only while an active linked hold exists, serialized by the item row lock. After release, current catalog units may change without rewriting history or converting balances; current balance units are labeled separately from historic hold units.

Every UUID replay checks current authorization and exact actor, source, scope and payload before returning the original record, including after release/status/archive. Duplicate requests never duplicate effects. New reserve/release mutations share one UUID namespace enforced by serialized cross-column database checks; old exact replay remains read-only.

## Browser recovery

The exact actor/order/scope-bound request is saved and verified before sending. Both linked actions carry `expectedActorId`, checked against the authenticated operator before mutation; this is a concurrency guard, never permission to act as that identity. A changed login cannot submit another actor’s uncommitted saved request. Old stored reserve payloads missing the expected unit or either action missing the actor guard fail closed and are never silently upgraded. Web Locks prevent concurrent tabs replacing it. Unavailable/corrupt storage fails closed. Network failures, generic 400/401/403/404/409 and malformed successes retain the original request. A structurally verified matching receipt clears it automatically. A narrow `NOT_RECORDED_CLOSED` outcome is issued only after current joint authorization, the canonical UUID mutex, no prior reserve/release result, and a terminal source status. Because supported order transitions never reopen COMPLETED/CANCELLED orders, all delayed duplicate requests remain unable to create that hold. This exact actor/order/payload-bound outcome enables an explicit discard-and-reload button; the payload stays stored until that action verifies the same envelope under the browser lock. A reload loses the in-memory verdict, so retry the original request to verify it again. All stock shortages, actor/payload conflicts, unknown outcomes and other transient rejections remain retained. There is no generic cancellation/tombstone protocol. Do not erase browser storage to replace an uncertain outcome.

History is paged at 50 records; CSV/print explicitly cover only the selected page/filter. They preserve original unit and release/actor history and do not combine unlike units into totals.
