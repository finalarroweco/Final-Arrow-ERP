# Foundation implementation

The application shell is a design preview. Its module cards do not represent working modules. The first working slice covers account creation, sign-in, company and branch creation, and company-wide or branch-specific departments.

## Database boundaries

- A tenant is the subscribing organization. A tenant has companies; a company has branches.
- Users are global identities. Memberships attach users to tenants. Role grants attach roles to memberships, and access scopes restrict grants to a tenant, company or branch.
- Composite foreign keys on company and branch relations prevent linking a branch or department to a company in a different tenant.
- Service queries must always filter by tenant and then check a user's active membership, permission and scope on the server. A tenant ID from a request is never sufficient authority.
- The initial SQL migration enforces the conditional shape of AccessScope: TENANT has no company/branch, COMPANY has company only, BRANCH has company and branch.
- AuditLog is append-only by application policy; database permissions and retention policy will be added before production.

## Local development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `docker compose up -d`.
3. Run `npm install`, `npm run db:migrate`, and `npm run dev`.
4. Open `/register` and create a workspace. The first account becomes its Owner.

This milestone includes password authentication, hashed server sessions, owner permissions, authorized company/branch/department creation, and seven-day single-use invitations for Viewer or Manager roles scoped to a tenant, company or branch. Invitation links are returned only when created; the inviter must deliver them securely to the intended person. Acceptance creates a new account or requires an existing account with the invited email to sign in. Owners can list team members and pending invitations, suspend or reactivate non-owner members, and revoke pending invitations. Suspension immediately stops access while preserving the grants. `npm test` checks scope matching denial cases. CI starts PostgreSQL, applies migrations, runs `npm run test:db` for cross-tenant constraints, and runs `npm run test:api` for invitations, revocation, suspension and branch visibility.

Email verification, password reset, login throttling, custom roles, financial operations and production deployment remain outstanding. Registration is disabled by default in production; `ALLOW_REGISTRATION=true` opens it and should be used only after abuse controls and account recovery exist.

## CRM customer and lead slice

Customers belong to one company and optionally one branch. Company-scoped roles see its customers; a branch-scoped role sees only customers assigned to that branch. Codes are unique within a company. Create, update, archive and restore are checked on the server and recorded in the audit log. The `/crm` screen provides paged lists of active and archived records. `/crm/leads` tracks scoped leads through NEW, QUALIFIED, PROPOSAL, WON and LOST. Conversion to a customer is an atomic, one-time transaction that requires both lead conversion and customer creation permissions. Contacts, duplicate merging, importing and customer portals remain future work.

## Sales quote slice

Accepted quotes can create one internal sales order each. The order stores the customer name, currency, totals and line items as a fixed snapshot of the accepted quote. It keeps company and optional branch scope, and the database enforces a unique source quote plus matching tenant and company foreign keys. `/sales/orders` lists orders within a user's read scope. This is an operational record; invoicing, payments and tax accounting are not implemented yet.

Sales orders start in NEW. Authorized managers can move them to IN_PROGRESS and then COMPLETED, or cancel a NEW or IN_PROGRESS order. Each transition records its time and actor in the audit log. Conditional updates reject repeated actions and keep completed or cancelled orders closed.

`/sales/quotes` creates draft customer quotes with one or more line items. Each quote uses its company's base currency, calculates line amounts and subtotal on the server with exact decimal arithmetic, and records an audit event. A branch quote may reference a customer from the same branch or a company-wide customer; a company-wide quote may reference only a company-wide customer. Read, create, update, send and decision permissions are checked independently, with branch-limited listings. A draft's notes and lines can be replaced atomically; the total is recalculated on the server, and conditional status checks prevent editing after sending. A draft can be marked sent, then accepted or rejected; the transition is conditional and audited so concurrent or repeated actions cannot change a closed quote. Marking sent records an internal status and does not send an email. Tax, discounts, PDF export and invoicing remain future work.
