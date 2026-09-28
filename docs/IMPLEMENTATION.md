# Foundation implementation

The application shell is a design preview. Its module cards do not represent working modules.

## Database boundaries

- A tenant is the subscribing organization. A tenant has companies; a company has branches.
- Users are global identities. Memberships attach users to tenants. Role grants attach roles to memberships, and access scopes restrict grants to a tenant, company or branch.
- Composite foreign keys on company and branch relations prevent linking a branch or department to a company in a different tenant.
- Service queries must always filter by tenant and then check a user's active membership, permission and scope on the server. A tenant ID from a request is never sufficient authority.
- The database schema alone cannot enforce the conditional shape of AccessScope: TENANT has no company/branch, COMPANY has company only, BRANCH has company and branch. Add database CHECK constraints in a migration before exposing grant mutations.
- AuditLog is append-only by application policy; database permissions and retention policy will be added before production.

## Local development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL with `docker compose up -d`.
3. Run `npm install`, `npm run db:migrate`, and `npm run dev`.

This milestone does not yet include authentication, invitation delivery, authorized CRUD endpoints, financial operations, or production deployment. Those require an identity provider/session design, server-side authorization, migrations, and tenant isolation tests.
