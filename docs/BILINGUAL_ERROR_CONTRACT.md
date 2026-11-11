# Bilingual error presentation

This candidate adds a public error-code contract and safe Arabic/English presentation. It does not declare the ERP complete or live, change authorization, or introduce SQL migrations.

## Contract

`apiJson` wraps the existing Next JSON response boundary. Successful bodies, status codes, headers and cookies pass through. Error responses receive a stable top-level `code`. Existing domain codes, nested actor codes, and domain-specific outcome receipts are retained. Unexpected 5xx bodies are replaced with a bounded unknown-outcome response instead of disclosing implementation details. Non-JSON framework failures remain possible and must be treated as unverified outcomes.

Common categories: `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED`, `UNAVAILABLE`, `UNKNOWN`. Explicit report boundaries use `RESULT_LIMIT`. Actor-specific `ACTOR_MISMATCH` and `ACTOR_REQUIRED` retain their original meanings.

`presentApiError` accepts only allowlisted codes, with a status-based fallback. Authentication and permission HTTP statuses override contradictory payload codes. It does not translate or interpolate error strings, HTML, object values, database messages or human-entered content. `presentCaughtError` displays only errors deliberately constructed as localized presentation errors; network and JSON exceptions use a safe unknown-outcome notice.

## Coverage

- Existing JSON API routes, middleware and response-producing library helpers in the 86-migration candidate.
- Legacy project/task/time/budget/billing, purchasing, sales, CRM, HR, approvals, inventory, POS, accounting, reports, settings, import and invitation error notices previously rendering raw response text.
- Bank UI hides raw transport/recovery-hook errors while leaving its actor-bound recovery controller unchanged.
- New approval workflows, recurring billing, private alerts, finite automation and approved-time invoicing retain their existing bilingual recovery messages and state machines, and receive the shared API error envelope.
- Release status now acknowledges implemented approval policies, explicit recurring draft billing and approved-time draft invoicing, without claiming unattended scheduling or deployment.

## Safety boundaries

The presentation helper never clears pending requests, changes request IDs or bodies, decides whether a write committed, retries automatically, or changes check-and-abandon behavior. Unknown/conflict copy instructs review of current records and pending requests rather than asserting rollback or success. Existing exact request storage, hashes, actor/scope fences and verified receipt checks are unchanged.

This is not a full translation audit. Human-entered text remains literal. Domain-specific CSV validation diagnostics, some machine state labels and API compatibility `error` strings may remain English; callers should use `code` for presentation. Existing legacy workflows without durable retry support do not acquire it through this change. The automation runner retains its safe static error text, status and aggregate-only success payload; only stable category codes are added. No runner credential, scheduler, job or provider is configured.

## Verification

The test suite includes table-driven AR/EN category, malformed-payload, domain-code, status/header and privacy checks. Mounted component tests cover project notices, safe report failures, raw hold-error suppression, unknown/network/invalid-JSON mutation outcomes and byte-for-byte retry preservation. Existing scope/actor change, delayed response, unmount, retry and abandonment suites remain part of the full unit run. Exact final lint, type, build, database and API results are recorded separately with the candidate commit.
