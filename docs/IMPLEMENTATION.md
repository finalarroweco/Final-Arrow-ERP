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

This milestone includes password authentication, hashed server sessions, owner permissions, authorized company/branch/department creation and an audit entry for each creation. `npm test` checks scope matching denial cases. The CI workflow starts PostgreSQL, applies the migration, and runs `npm run test:db` to verify cross-tenant foreign keys and scope constraints. It does not include email verification, password reset, login throttling, invitations, permission administration, financial operations, or production deployment. Registration is disabled by default in production; `ALLOW_REGISTRATION=true` opens it and should be used only after abuse controls and account recovery exist.
