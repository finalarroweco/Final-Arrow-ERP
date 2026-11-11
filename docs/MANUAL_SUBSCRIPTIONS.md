# Manual subscription register: bounded review candidate

The `/manual-subscriptions` workspace tracks known customer agreements and operator-entered review dates. It is an internal register, not an automatic billing platform or a completed Subscriptions module. The recorded service label is free text, not a configured billing plan. An agreement reference is a reference supplied by an operator, not a signed contract or evidence of acceptance.

No money, prices, recurrence, invoices, balances, revenue, VAT, proration, payments, renewals, entitlement changes, alerts, external sharing or contract acceptance are implemented. There are no scheduled jobs or automatic date transitions. Existing customer, invoice, settlement, accounting, VAT and stock data are not changed by register operations.

## Records and explicit revisions

Creation fixes tenant, company, optional branch, customer, internal reference and creator. Operators enter a service/plan label, optional plain-text description and agreement reference, optional calendar start/end dates, optional **next review date**, and an operator-reported status: planned, active, paused or ended. A recorded status changes only this internal record; it never activates, pauses or terminates a service or agreement. Start/end dates describe the operator's record. They are not billing dates. When both are supplied, end must not precede start. Next review is independent and does not schedule a reminder.

Every explicit edit has a required reason and saves a complete immutable revision. Archive and restore append complete revisions on the same monotonic version. Archiving hides a record from the default register; it does not cancel an agreement or delete history. Restore makes the current archived record visible again, not an older revision. No autosave, delete, source reassignment or historical overwrite is provided. If the wrong customer or scope was selected, archive the record and create a new one with the correct source.

## Scope and customer privacy

Every list, search, filter, detail, historical revision, CSV, text download, print and request replay requires both `subscription:read` at the record scope and `customer:read` at the customer's actual scope. Management also requires `subscription:manage`. Source authorization is applied in the database query before pagination. Authorizing a record never implicitly authorizes its customer's name/code snapshots.

Branch grants do not expose company-wide or sibling records or company-wide customers. A company-wide customer can be referenced by a company-wide or branch register record only when the operator has actual customer access. A branch customer can be referenced only by a record in that same branch. Tenant and company must agree. New records require an unarchived customer. Customer archival does not remove authorized historical reading, exact committed recovery or corrections to an existing record. Stored customer identity/scope references cannot be detached to undermine history. This restriction also applies when the only reference is a permanently abandoned request: abandoning a draft attempt does not release the customer for later scope reassignment. Only name/code snapshots are retained, not customer contact details.

Existing and newly registered Owners receive the private register permissions. Built-in Manager and Viewer roles do not receive them automatically. Custom roles must explicitly opt in. Generic audit reports exclude the private register, revisions and request records. Required audit metadata does not duplicate agreement text.

## Submission and recovery

A request UUID is bound forever to its actor, scope, customer, action, expected version and exact canonical payload. A committed retry returns its original event, never the latest record. A stale new request conflicts. Check-and-abandon returns the original committed event or records a permanent tombstone for that exact request, preventing a delayed write from executing.

Transactions use READ COMMITTED with tenant locking before fresh authorization and consistent request, customer and record locking. Customer/record changes are serialized with relevant writes. History and current detail are read coherently. Database-generated timestamps, immutable events and guarded current projections provide ordinary application integrity. Guards also reject DELETE/TRUNCATE and require same-transaction audit. This is not tamper-proof against database owners or superusers who deliberately disable or modify DDL guards.

Unsent drafts stay in memory. Submitted uncertain requests, including complete agreement text, are saved in this device's localStorage for recovery. This is disclosed in the workspace; it is neither encrypted storage nor private to the original author on a shared device. Actor/scope-bound keys, cross-tab coordination, exact frozen requests and verified receipts prevent accidental replacement or actor-switch submission. Workspace reads and download/print links also carry the mounted actor identity; a changed session is rejected before reading private data. JSON reads verify the authenticated actor in the response. A shared read epoch fences delayed register, detail and customer-picker results after a current access denial or actor-receipt mismatch, without changing submitted mutation recovery. Retained output clicks are blocked after invalidation, but native navigation/downloads already dispatched and data already delivered cannot be retracted. Invalid or inaccessible storage does not silently discard a pending request.

## Limits and exports

- Service label: required, up to 200 Unicode code points.
- Agreement reference: up to 200 code points; empty is allowed.
- Description: up to 64 KiB UTF-8; empty is allowed. Unicode and line breaks are preserved.
- Reason: required for every operation, up to 300 code points.
- Dates: real Gregorian calendar dates in `YYYY-MM-DD`, or explicit null to clear an optional date.
- Request wire size: at most 420,000 bytes, shared by mutation and resolution. Valid worst-case JSON-escaped 64 KiB text fits.
- Register and history: 50 rows per page, without a lifetime revision cap.
- Metadata CSV: at most 5,000 matching rows. Oversized exports fail explicitly rather than truncating. Formula-leading cells are escaped; descriptions and change reasons are not in metadata CSV.
- Selected revision text/print: requires an explicit authorized event. Literal text is not parsed as HTML, Markdown, links or embedded resources. Downloads use generated identifiers in filenames and attachment/nosniff/no-store headers.
- Unknown fields and unknown or duplicate filters are rejected. Review-date bounds are inclusive and filter the recorded next review date only.

## Verification and remaining acceptance

The feature's automated tests target source/record permission intersections, company/branch/tenant boundaries, current revocation after a real lock wait, archived customers, immutable identities, exact replay, conflicting payloads, concurrent lifecycle edits, delayed writes and permanent abandonment. They also cover calendar/null validation, Unicode/wire limits, literal markup, metadata CSV, historical pagination and unchanged customer/financial/stock data. Database checks must cover fresh migration, populated 77→78 preservation, atomic visibility and rollback, direct SQL tampering and provider default grants. Consult the implementation report for checks actually executed and their evidence; this checklist is not a test result.

Still required before release: supported-browser AR/EN/RTL, mobile, keyboard/accessibility and physical-print acceptance, and actual-browser interrupted submission, reload, actor switching and multi-tab recovery. The development runtime does not provide browser acceptance. No production migration, deployment or provider setup is included.

The broader planned subscription platform remains unimplemented. Billing frequency/calendar rules, timezone cutoffs, currencies/pricing/tax, invoicing/accounting recognition, notice periods, renewal authority, cancellation/refund/proration, suspension/entitlements, notifications/providers, signatures and retention obligations need separate product decisions and implementation.
