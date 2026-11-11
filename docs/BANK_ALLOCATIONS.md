# Explicit bank allocations

This workflow records manual reconciliation links. It never changes original bank movements, journal lines, balances, or payments.

## Scope and arithmetic

- Choose one bank movement, one book movement and an explicit positive amount with at most three decimals. Amounts are exact milli-units, up to `999999999999999.999` per allocation/source.
- Both sources must belong to the same tenant, company and bank asset account, have the same currency and direction, and the journal date must not exceed the selected bank statement's ending date. The bank statement must not be voided.
- Repeating an allocation supports one-to-many, many-to-one and partial many-to-many. There is no automatic allocation ordering, opposite-direction netting, FX, fee recognition, tolerance, writeoff or automatic journal.
- Active allocation sums cannot exceed either original source's absolute amount. Current capacity includes every active allocation, including bank movements booked after an earlier viewed cutoff.
- Book remaining through a statement cutoff includes only active allocations whose bank booking dates are through that cutoff. It can be nonzero while current capacity is zero. That amount is displayed but is not offered for another allocation.
- Outstanding book total is the signed sum of cutoff residuals. Adjusted bank equals statement closing plus outstanding book total; difference equals book closing minus adjusted bank.
- Every incompletely allocated nonvoid imported bank movement through the cutoff counts as pending. Offsetting incomplete incoming/outgoing movements cannot produce reconciled status merely by cancelling numerically.

This is an observation **now**, through the statement's booking cutoff. It is not an as-of view of allocation creation timestamps or a frozen accounting close.

## Corrections, permissions and retries

Cancel an allocation once with a reason, then allocate again with a new request ID. Amount edits, deletion and reactivation are prohibited. A statement can be voided only after all active allocations are cancelled. Ledger period locks do not prevent reconciliation because this workflow posts no journal.

The API retains the legacy `action: "match"` exact full-match path: equal original signed amounts and no active allocation on either source. It does not reinterpret old full-match requests as partial allocations. Explicit amounts use `action: "allocate"`.

All match/allocation/cancellation and void writes require `X-Expected-Actor-Id`. Authorization is checked inside the transaction, with tenant shared lock followed by request-ID lock and account lock. Current company-wide ledger read and post permissions are required before both a first write and a replay. Request IDs bind to actor, statement, source pair, action and normalized amount. An exact retry of an allocation returns its original record even after cancellation or statement void, provided current authorization remains valid.

The browser persists an actor/tenant/company/account/statement-bound request before sending and serializes prepare/send/clear with Web Locks. Storage failure blocks new writes. Legacy actor-less pending requests remain quarantined. Transport loss, malformed responses, authorization errors and generic conflicts never automatically clear a saved request. Only an exact verified receipt clears it. The explicit “Check outcome and abandon if not saved” action serializes against the original write. If it already committed, its original outcome is returned; otherwise an immutable audited abandonment record permanently blocks that request ID, including delayed duplicates, before the browser clears it. Successful request IDs are also durably bound across allocations, cancellations and voids, so they cannot be reused for another action or account. Changing accounts or navigating does not turn an uncertain request into a replacement action.

## Database and snapshot compatibility

Forward migration `20261111100000_bank_allocations` is one transaction. It backfills every historical active/cancelled match amount from the immutable original bank amount, preserves old IDs/actors/timestamps/correction fields, replaces the active uniqueness indexes, and switches capture to v2 before committing. None of the 74 prior migrations changes.

Direct SQL writes enforce current actor scope, account serialization, aggregate capacity, immutable corrections and same-transaction audit. Allocation, cancellation, void and certificate insertion fail closed outside Read Committed isolation, preventing a stale Repeatable Read snapshot from bypassing current capacity after a lock wait. New allocation, cancellation, void and request-resolution timestamps are assigned by the database, while the upgrade preserves historical timestamps. Live reads recheck permissions under Read Committed after the tenant lock, then build the report from one coherent SQL source snapshot. Audit validation checks both transaction metadata and the audit row's actual insertion transaction.

New snapshots use deterministic v2 allocation arrays with amount, source identity, actor and retained cancellation history, plus current/cutoff residuals. Saved v1 JSON, summaries and digests remain unchanged and readable, printable and downloadable. A committed pre-upgrade capture retry returns its original saved v1 certificate; an unsaved stale preview is rejected and must be refreshed. Canonical hashing is unchanged.

Limits reject rather than truncate: 20,000 book movements, 20,000 imported bank movements, 20,000 relevant allocation/history records, 5,000 outstanding book movements and 16 MiB. SQL checks source/history counts before nested JSON aggregation. Live reconciliation applies matching source/history/output limits.

## Deployment and verification

Apply the complete forward migration and deploy the corresponding application build together in a controlled maintenance window. Old application clients cannot create amount-less records after the migration; old browser pending requests require outcome review rather than automatic resubmission. Take and verify an ordinary database backup before an authorized deployment. This change itself does not perform a deployment or access production.

Run `npm test`, `npm run lint`, `npm run test:db`, `npm run build`, `npm run typecheck` and `npm run test:api` against a disposable PostgreSQL database. The allocation API suite and direct-SQL suite use synthetic fixtures only. They cover exact milli/max values, both cardinalities/directions, cutoff/current capacity, duplicate identity/replays/corrections, capacity races, revocation, audited cancellation/void, v1/v2 snapshot parity and forged-source rejection. UI hook tests cover interrupted/repeated requests, storage failures, account/navigation changes, cross-tab locking and receipt identity. Browser-based visual testing is a separate release gate.
