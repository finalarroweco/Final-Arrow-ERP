# Explicit project milestone billing

This is a bounded internal workflow. Automated development verification is separate from user-led browser and business acceptance. No live database action, deployment, merge, or customer communication is included.

Operators define a named deliverable and its explicit customer, currency, exact nonnegative three-decimal agreed price, tax treatment and paired optional payment terms/due date. Nothing is inferred from project percentages, recorded time, budgets, payroll, sales orders or subscriptions. Definitions are immutable. Mistaken unbilled definitions can be cancelled with a reason and replaced by a separately reviewed definition; cancellation never deletes history.

Completion and approval are separate explicit, reasoned actions. Approval requires its own scoped permission. Definitions and their original commercial agreement remain unchanged by completion or approval. Milestone operations require an operationally open project. No completion or approval reopens completed/cancelled projects.

One approved milestone entitles exactly one original genuine DRAFT invoice. Its immutable permanent claim survives voids. The invoice uses a snapshot of the approved commercial agreement and the current invoice-creation UTC date's VAT profile, not the date the milestone was defined or approved. Preview binds the entire actual current VAT profile, including an inactive profile, and final amounts require explicit review. Selected STANDARD/ZERO/EXEMPT treatment is distinct from current VAT activation. Money uses exact three-decimal arithmetic and existing per-line HALF_UP tax calculations.

An explicitly selected financial correction requires the latest original-linked invoice to be VOID and all dependent posting/settlement journals to be reversed. The correction retains the original milestone entitlement, customer and currency, with explicit revised price/treatment/terms and a reason. It produces another DRAFT invoice and immutable source, not another milestone or claim. Original UUID retries always resolve to their original receipt. VOID is terminal. This is an internal financial correction workflow, not a claim of statutory credit-note compliance.

Already-approved unbilled milestones may be invoiced after project completion. Cancelled projects cannot start fresh billing. Existing entitlements may undergo the narrowly defined financial correction after completion or cancellation, without reopening operations. Historical source reads remain available after closure or archival subject to current independent project, milestone, customer and invoice permissions. Current source constraints still govern fresh actions.

Source, claim, request, project link and audit histories are permanent. Fresh actions intersect current tenant/company/branch/project/customer and action-specific permissions, without project-time grants. Owner alone receives new permissions by default, including actual newly registered accounts. Exact actor/body-bound terminal recovery rechecks session and authorization after waits. No automated issue, posting, payment, delivery, stock movement, costs or payroll is included.


## Read and recovery boundaries

Definitions and source history use explicit 50-row pages. Initial definitions and later reviews use immutable actor/body-bound requests; invoice creation has a separate request namespace. Actor/company/branch/mode-scoped browser storage with cross-tab locking preserves the exact request before dispatch. A lost reply is an unknown result, not evidence of failure. Retry and check-and-abandon resolve the original committed receipt or a permanent abandonment. A malformed or unverifiable response cannot erase pending intent. Current permissions and session remain required even for recovery; historical closure, customer archival and later milestone state do not reinterpret an already committed exact receipt.

Customer identity, project identity and currency cannot change in financial correction. Deliverable descriptions remain those of the immutable original milestone. Agreed price, tax treatment and paired terms/date may be explicitly corrected. Existing saved drafts can continue through authorized financial lifecycle actions after project closure; this does not reopen milestone operations. Final invoice tax uses the current VAT profile and must be reviewed separately from the agreed treatment.

The existing 1000-link lifetime project invoice-history limit also applies to milestone invoices and their corrections.

Existing real-order document read behavior is unchanged. Milestone source reads intersect project, milestone and customer scope without requiring project-time permissions. Source-filtered customer and project reports retain their existing visibility contract; general ledger totals remain complete under ledger authorization, with unauthorized source drilldowns hidden.


## Retained scope and shared invoice lifecycle hardening

The public project API does not support moving projects between branches or companies. An additional trusted-backend guard prevents such scope changes once a milestone definition exists, including cancelled and unbilled definitions. Unrelated legacy projects retain their existing behavior. This prevents orphaning retained agreements; it is separate from exposed API authorization.

The shared invoice issue/void route also revalidates the exact browser session and current source/action permissions after its source waits. Generated project sources lock Project before Invoice, matching generation/correction ordering; a trigger cannot introduce a late project wait after authorization. Expired/revoked sessions return401, revoked rights403, and invalid repeated lifecycle transitions retain409. This application-route security correction applies to all invoice sources without changing their rights.

Session identity is share-locked first and expiry is checked in a separate subsequent UTC-clock query, so even time passing while waiting on the session row cannot reuse a predicate evaluated before that wait. New milestone action, preview, generation and read helpers use that same exact-session check. No ongoing browser credential or session is created by billing.

Approved-time browser requests and automation browser commands/history now reuse the same shared post-lock UTC session check. Explicit unattended automation continues to use its existing persisted authority without a browser session. This does not authorize additional jobs, sources, actions or roles.

Time and milestone financial correction preparation prelocks only the scoped selected prior invoice after Project and before final session/current-scope checks. The later SQL correction guard therefore cannot introduce a prior-invoice wait after authorization. Exact saved requests still recover their original immutable receipts, including after void or correction, and never create another claim.

Milestone COMPLETE/APPROVE/CANCEL requests intentionally contain no customer override. Before business-source waits, the server resolves the immutable milestone customer only inside the exact tenant/company/branch/project/milestone scope, then takes Company → Customer → Project locks before session and current-grant checks. This prevents the deferred action guard from introducing a later customer wait. Production regressions exercise all three transitions against an unchanged Customer row lock with elapsed session expiry, current-grant revocation, and valid controls, including exact saved-request retries. The explicit migration87 lock audit covers Tenant/Company/Customer/Project, the selected correction Invoice, and the generated same-transaction Invoice used by the permanent ProjectInvoiceLink; no additional existing business-source lock is deferred past final authorization in milestone operations.
