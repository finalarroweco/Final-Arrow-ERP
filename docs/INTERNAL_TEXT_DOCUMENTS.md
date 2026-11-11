# Internal text documents: bounded review candidate

The `/documents` workspace records internal operating notes and reference text. It is not a completed document-management or workflow system. It has no attachments, source-record links, HTML/Markdown, approvals, signatures, external sharing, retention rules, scheduled deletion or autosave. Operators explicitly choose company/branch, title, body and change reason. Company-wide text is readable by authorized company-wide readers, not private to its author.

## Operation and permissions

`document:read` permits scoped register, detail, paginated history, metadata CSV, selected-version UTF-8 download and print. `document:manage` additionally requires read permission in the same scope. New and existing Owners receive these rights; Manager and Viewer receive none automatically. Branch grants see exactly that branch, never company-wide or sibling-branch records. Visibility is applied before search and pagination. Every route reauthorizes against current membership/grants in its transaction. Workspace-generated read, CSV, text-download and print URLs bind the mounted actor; a session switch in another tab is rejected before document reads, and JSON responses must match that actor before being displayed. Direct authenticated API clients may omit this optional read guard. A shared workspace read epoch invalidates register/detail responses and stale output clicks when a current read, mutation, retry or resolution detects an authentication or actor change, including non-JSON authentication failures. Notifications capture their original read epoch, so obsolete failures cannot clear a newer reauthenticated view. Ordinary business conflicts and network errors do not revoke the read epoch. Mutation recovery and verified commit handling remain independent. Outputs use native download/new-tab links, not a queued print renderer; data already dispatched to a browser download or separate navigation cannot be retracted. Generic audit reports omit these private entities and never duplicate title/body in audit metadata.

Creation saves version 1. Every explicit edit saves a complete immutable snapshot and reason. Archive/restore also append immutable snapshots and increment the same version. Archive hides records by default without removing history. Restore makes the current archived content active; it does not copy an older revision. Scope and original authorship never change. There is no delete operation.

## Integrity and recovery

A submitted UUID binds its exact actor, action, scope, expected version and canonical payload forever. Exact committed replay returns the original event, even after later edits or archive. Conflicting versions produce explicit conflicts. Request resolution returns the original committed event or permanently abandons that exact request, preventing a delayed retry from executing. All writers use tenant SHARE lock, request advisory lock, document advisory/row lock, in that order under READ COMMITTED. Permission mutations serialize on the tenant. The database, not the client, assigns event identities/timestamps and appends audited history while updating the protected current projection. Delete and truncate guards protect ordinary DML, including accidental privileged commands and cascading truncation. This is not tamper-proof against database owners/superusers who deliberately disable or alter those guards.

Unsent drafts remain in memory. Submitted uncertain requests are stored in localStorage, including their complete text. The workspace visibly discloses that this saves text on this device; it is not encryption or author-private storage. Recovery keys bind actor/company/branch, cross-tab locking prevents replacement, and only exact verified receipts remove pending data. Operators can explicitly retry or check-and-abandon. Text is rendered through React text nodes and textareas, never parsed as markup or autolinked.

## Technical limits

- Title: 200 Unicode code points. Reason: 300 code points, required for every operation.
- Body: 64 KiB UTF-8, nonempty; Unicode and line breaks are preserved.
- JSON request: 420,000 bytes (including worst-case JSON escapes for a valid body). Unknown fields and unknown/duplicate query parameters are rejected.
- Register/history: 50 records per page. There is no lifetime revision-count cap.
- Metadata CSV: at most 5,000 records; larger exports fail explicitly. Formula-leading cells are escaped. Body/reason are not included.
- Text download and print require an explicit selected event. Filenames contain generated UUID/version only; responses disable caching and downloads use attachment and nosniff headers.

## Acceptance checklist

Automated checks cover cross-tenant/company/branch privacy, revoked access, original response replay, conflicting payloads, lifecycle/version races, permanent abandonment, SQL projection/history/request/audit tamper, literal script text, Arabic/English/emoji, byte limits, CSV formulas, history pagination and provider-default privilege revocation. The populated 76→77 migration must preserve existing financial/stock/bank/role/request records and publish atomically. See final implementation report for exact executed results.

Remaining manual acceptance: browser appearance/accessibility and Arabic/English RTL layout; interrupted submission, refresh, actor switching and two-tab recovery in actual supported browsers; physical printing. Runtime browser access was unavailable during development. Broader document governance, approvals/signatures and enterprise DMS remain unimplemented. No production migration, deployment or external sharing is included.
