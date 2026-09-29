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

## CRM customer slice

Customers belong to one company and optionally one branch. Company-scoped roles see its customers; a branch-scoped role sees only customers assigned to that branch. Codes are unique within a company. Create, update, archive and restore are checked on the server and recorded in the audit log. The `/crm` screen provides paged lists of active and archived records. Leads, opportunities, contacts, merging duplicate customers, importing, sales workflows and customer portals are future work.
