# Manual inventory reorder policies

## Scope

`/inventory/reordering` is an internal manual register and current observation, not a purchasing engine. A user explicitly chooses a concrete branch and an eligible branch-specific or company-wide inventory item, then enters minimum and target quantities. Both are nonnegative fixed-three-decimal strings compatible with Decimal(18,3), at most `999999999999999.999`. Target must be at least minimum. No threshold, policy, supplier or purchase quantity is inferred.

Create, correction, archive and restore each require an explicit reason and write an immutable revision. Scope, item identity, original unit and unit generation remain immutable. One unarchived policy per tenant/company/branch/item prevents duplicate policies across units and generations, including restore races. Archive the old policy before explicitly creating a replacement. Archival preserves history and never changes stock.

There is no stock mutation, purchasing document, supplier selection, purchase recommendation, financial effect, notification or automation. Do not total quantities across different items or units.

## Current quantities and completeness

The query begins with configured policies, not stock balances or the existing limited stock picker. A never-stocked item has zero physical and reserved quantities without creating a balance.

- Available quantity = physical quantity − reserved quantity.
- Below minimum iff available quantity < minimum. Equality is not below.
- Informational gap to target = max(target − available, 0). This is not a recommended order quantity.

Policy, current source/unit and balance are read in a coherent database observation. A response carries its observation time; it is not a historical as-of report. Paging and refreshes can observe later stock. The low-stock filter applies before pagination, so results beyond the first page remain reachable. Searchable item selection has separate pagination and includes eligible company-wide items for exact-branch stock readers without demanding company-wide catalog rights.

Archived policies and unavailable sources have no current quantities. Source archival or moving an item outside its policy's original branch/company leaves policy history intact but makes the source unavailable. Original metadata is retained; source edits do not rewrite prior policy revisions.

## Units and safe replacement

`InventoryItem.reorderUnitVersion` increases on every actual unit change. Policy creation captures that generation and unit permanently. A different generation requires review even when the item unit was changed away and then back to its old text. No quantities are converted and no new global restriction blocks existing unit-edit workflows.

An obsolete policy cannot be corrected or restored for the new generation. Archive it and create a new policy after explicitly choosing the current unit and thresholds. This is deliberately conservative: a harmless spelling/unit cycle also requires a replacement. The generation is not a stock-unit conversion system and does not repair historical inventory semantics.

Legacy source units are preserved exactly, including Unicode, multiline text and an empty string. The Arabic/English interface explicitly labels an empty source unit as unspecified; this display label is never substituted into requests, receipts, revision history or CSV. No default unit or conversion is introduced.

## Authorization, durability and audit

Reads require current active membership and `inventory-stock:read` at the policy's exact branch. Writes require both that stock read and independent `inventory-reorder:manage` coverage of the same branch. Grants are not combined into a broader union. The new manage right defaults only to Owner; existing Manager/Viewer scopes are unchanged. Authorization is rechecked on replay and recovery. Page scope enumeration loads grants once per tenant rather than querying per branch.

Requests have separate request and policy UUIDs, an expected actor, immutable source identity and expected version. Exact retries return the same terminal result; changed payloads, wrong actors and stale versions fail closed. Check-and-abandon returns an already committed result, otherwise records a permanent exact-request cancellation so the UUID cannot execute later. It does not undo a committed revision. Database constraints and trigger-generated audit records protect the trusted-backend write path; they are not protection against a database administrator disabling schema guards.

The UI freezes submitted requests in unencrypted actor/scope-specific browser storage before dispatch, requires cross-tab locking, and never silently creates a replacement after an uncertain result. Invalid or foreign stored requests remain quarantined. Only an exact validated terminal result clears unchanged stored bytes. Unsent drafts stay in memory.

List, detail, picker and CSV reads verify actor receipts and strict schemas before displaying private data. Reads and output callbacks are fenced by mounted scope, operation sequence and access epoch. Each mutation attempt captures its read epoch before dispatch, so an old failed attempt cannot invalidate a newer authenticated observation. An authorization loss clears the workspace without deleting pending bytes.

Revision reasons and author identity are available only through scoped policy history. The generic audit view does not expose private policy reasons. Metadata CSV excludes reasons, quotes cells and neutralizes leading formula characters. The UI downloads a newly authorized, strictly verified current JSON page rendered as CSV; a page export is not an all-pages snapshot.

## Migration and verification limits

Migration 80 is additive and atomic, preserves prior migration checksums and manufactures no policies, revisions, requests or historical records. Do not remove durable cancellation/identity guards after use; doing so would permit delayed requests to execute. Source unit generations are initialized to zero without pretending to know pre-migration unit history.

Focused unit/mounted-component tests cover exact quantities, strict output validation, pagination, literal text, CSV, immutable identity, request persistence, retries, recovery, account/scope changes and delayed authorization failures. Integration verification must be recorded against the final commit, including fresh 80 migrations, populated 79→80 upgrade preservation, direct SQL guards, races, privilege profiles, unit cycles, missing balances, reservation/movement changes and API connection pools.

Browser acceptance is **not run**. Mounted hook tests, lint, type checks and builds do not replace real browser, accessibility, Arabic typography, security, operational or business acceptance. This feature is not a claim that the ERP is production ready or deployed.
