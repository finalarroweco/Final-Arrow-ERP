# Permanent abandonment of bank import requests

This feature resolves an uncommitted, actor-bound import request without importing it. It does not void or reverse an existing statement, contact a bank, change money, alter journal entries or allocations, or issue/revoke reconciliation certificates.

## Recovery contract

Only new version 2 envelopes identify the original operator and exact saved request. The explicit permanent-abandon action sends that unchanged strict body to `POST /api/bank/statements/requests/abandon`, with `X-Expected-Actor-Id`. The server authenticates the cookie, compares the expected actor, recomputes the original normalized SHA-256 digest, and requires active membership and company-wide `ledger:read` plus `ledger:post` permissions. The actor remains separate from the existing digest algorithm.

The server first checks for an existing statement with that UUID. Exact scope, account, digest and original creator return `COMMITTED`, including when that statement was subsequently voided. Abandonment never mutates the committed record. A different identity conflicts without disclosing it.

Otherwise an exact existing cancellation returns `ABANDONED`, without a second audit event. A new cancellation is committed atomically with a trigger-generated audit event before returning `ABANDONED`. The tombstone stores digest-bound identity and transaction/time/audit identity, not a second copy of CSV, lines, amounts or reference. Every future statement insert with that UUID is rejected, even if its actor, body, account or scope changes.

The read-only check endpoint can observe an exact `ABANDONED` receipt. It does not create cancellations. `UNKNOWN` remains a nonfinal observation: a delayed import could still commit and the local envelope must remain blocked. A changed import requires a fresh UUID only after verified terminal resolution. Lost responses can be checked or the abandonment retried with the same original body.

The browser clears only the unchanged saved version 2 envelope after validating the complete terminal receipt against the original actor, scope, request UUID and locally recomputed hash. Errors, malformed/mismatched receipts, auth loss, stale callbacks, changed storage and unavailable storage retain or block the request. An already dispatched native network request cannot be recalled; the durable database guard provides the delayed-import fence.

Legacy actorless sessionStorage is still quarantined. It is never displayed, sent, adopted, upgraded or discarded by this feature. No administrator takeover is provided.

## Serialization and security boundary

Import, abandonment and insert guards use the order: tenant SHARE lock, scoped asset account UPDATE lock, dedicated `bank-statement-import:<UUID>` advisory lock, then fresh authorization and immutable identity checks. READ COMMITTED is required. This preserves compatibility with old account-lock-first imports reaching the new insert guard. The dedicated namespace is separate from ordinary match/allocation request resolutions. No second account or conflicting statement row is locked after the UUID lock merely to compare immutable identity.

The immutable cancellation and its exact same-transaction audit are guarded against mutation, deletion, truncation and standalone forged audit insertion. The new table uses RLS and explicit PUBLIC and optional provider-role privilege revocations. Generic audit metadata must not duplicate the private request digest or cancellation identity. Existing statement totals, overlap, line-import transaction, currency, immutability and void guards remain in force.

This is a trusted backend database model. Passing an actor UUID to SQL does not authenticate a caller. It is not protection against a database administrator who can disable triggers, change privileges or modify schema. Production database credentials and schema-change authority must remain restricted.

## Controlled rollout and rollback

Migration 79 is additive and explicitly atomic. It must not change checksums of the preceding 78 migrations, fabricate historical imports/cancellations, or backfill committed records. Apply it before enabling the new server/UI action. Existing committed statements remain the authoritative committed receipts; no cancellation table row represents a commit.

Validate fresh installation and a populated 78-to-79 upgrade on disposable databases, including existing row contents, row versions, digests and certificates, before controlled production rollout. Test both vanilla roles and permissive provider-default grants. Do not treat simulated UI tests as browser acceptance.

**After the first tombstone is used, dropping the table or its insert guard is not a safe rollback:** delayed old requests could execute again. A rollback of application code must retain the migration's durable tombstones and guards. Any future schema replacement must preserve every UUID fence and audit invariant before removing the old mechanism. Stop new abandonment operations if troubleshooting is needed, but do not erase already issued terminal receipts.

UUID identity comparisons and advisory-lock keys use canonical case, including company-scoped permission checks. The original accepted UUID text remains unchanged in the historical hash input and saved body. Thus an uppercase original request can recover against PostgreSQL's lowercase UUID receipt, but changing UUID text case in an existing request body still changes its digest and conflicts.
