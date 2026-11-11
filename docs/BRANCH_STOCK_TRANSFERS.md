# Completed branch stock transfers

This workflow records an already-completed physical movement of one active company-wide inventory item between two distinct branches of the same company. The operator supplies the stock-unit quantity, reference and reason. It does not arrange shipping, reserve goods, fulfill a sales order or backdate stock.

## Scope and authorization

- Creation and full correction require current `inventory-stock:read`, `inventory-stock:adjust` and `inventory-transfer:manage` permissions independently at both branches. Only Owner receives the new management permission by default. Owners can deliberately delegate it using scoped custom roles.
- Register, detail, print and CSV require stock read at both ends. The print action reauthorizes and validates a fresh document and correction history before opening print. Authorization filters apply before pagination, export limits and counts.
- A reader of just one branch sees its own transfer quantity under generic movement text. The other branch, reference, reason and transfer link are not returned. Ordinary stock CSV also contains only generic transfer movement text.
- Write requests capture the expected actor as a concurrency check, never as authorization. The authenticated cookie actor must match before any write or cancellation, including a retry after signing in as another user.

## Quantity and audit integrity

- Quantities are positive decimal strings with at most three fractional digits, from 0.001 through 999999999.999. Physical balances retain the existing 18,3 bound.
- Creation captures the unit displayed by the form. A unit change before recording rejects the stale request rather than interpreting its quantity under a different unit.
- The database owns both balance changes and both linked movements. The source must have enough unreserved stock and the destination must remain within its quantity bound. Existing holds never change.
- The immutable document saves company, branch, item, stock-unit and actor labels, database recording time and transaction identity. The database creates an immutable audit record and verifies the exact opposite pair.
- Stock movement reports explicitly identify their basis as recorded movements only. They expose the scoped undated opening offset (null before initialization), warn in AR/EN when it is nonzero, and append the basis, offset and warning to CSV columns. The offset is never added to historical opening, running or closing totals and creates no backdated movement. Current physical balances remain in Branch stock.
- The first transfer establishes an immutable opening offset between a pre-existing balance and its historical movements. No historical stock is fabricated. Thereafter deferred guards require that balance to equal its opening offset plus all movements. Legal multi-movement receipts, returns and manual adjustments continue to work.
- History changes and first-transfer initialization serialize on the affected balance rows. Transfer-used movements and balance/item scopes cannot be rewritten. Raw SQL cannot omit a leg, detach it, bypass its projections, rewrite its audit or use the generic reversal audit to reverse a single leg.
- Server-only tables have row-level security enabled and public/browser role privileges revoked. Database guards supplement, rather than replace, server authorization.

## Corrections

A correction is an immutable opposite transfer linked to its original, with a new reason and current recording time. Only one full correction is permitted. It requires available stock at the original destination, the same item and exact original quantity/unit. A changed current unit blocks correction. A correction cannot itself be corrected. Original history is never deleted and neither leg can be reversed individually through the generic movement API or UI.

## Retries and abandonment

- Each write has a UUID and immutable actor, scope and payload identity. An exact authorized replay returns its original document without changing stock again. An altered actor or payload is rejected; current rights are checked even for an exact replay.
- The browser saves the exact request before sending. Actor/company-scoped Web Locks serialize preparation, retry, cancellation and clearing across tabs. Storage events refresh pending state. If browser storage or locking is unavailable, writes are disabled.
- Unknown responses, malformed receipts, network failures and generic conflicts preserve the request. The browser clears it only after verifying a complete matching saved document or a matching cancellation receipt. Navigating away does not discard it.
- Explicit abandonment uses the same server UUID mutex. If the transfer already exists, it returns that exact saved result. Otherwise an immutable, audited cancellation permanently blocks every delayed duplicate with that UUID. This is request cancellation, not reversal of recorded stock.
- A malformed saved browser record remains retained and cannot be submitted or discarded automatically. Other actor/company scopes remain usable.

## Concurrency

The write lock order is tenant SHARE, request UUID advisory mutex, item SHARE, missing balances inserted in branch order, then both balances locked in UUID order. Receipt item locks serialize receipt writes; existing returns, adjustments and holds serialize through their balance locks. Item archive/unit updates take the ordinary row-update lock and cannot change the selected item during a transfer. Current authorization uses the transaction client, including with a one-connection pool.

## Exclusions and verification limits

No in-transit inventory, approvals, intercompany transfers, branch-owned item remapping, unit conversion, automatic hold release, valuation, journal/tax entries, sales fulfillment or logistics integrations are introduced. Business operators remain responsible for confirming the physical transfer occurred and for selecting appropriate units.

Automated coverage includes input and interrupted-response components, paired API/database invariants, privacy, role revocation, cancellation races, decimal limits, first-transfer history races, catalog races, receipts/returns/holds/adjustment overlap and one-connection operation. Browser interaction was not run because this environment's browser runtime is unavailable. The work remains a review-only implementation, not authorization to merge, deploy or load live fixtures.
