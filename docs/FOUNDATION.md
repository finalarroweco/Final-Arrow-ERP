# Foundation Scope

## Core hierarchy
Tenant → Company → Branch → Department → User

## Initial entities
- tenants
- companies
- branches
- departments
- users
- memberships
- roles
- permissions
- role_permissions
- user_scopes
- currencies
- taxes
- sequences
- attachments
- comments
- notifications
- approval_requests
- audit_logs
- automation_rules
- automation_runs

## Security baseline
- Tenant isolation
- Company and branch scoping
- Role-based access control
- Explicit privileged actions
- Audit trail
- No direct cross-tenant queries
- Sensitive actions require server-side authorization

## First implementation milestone
1. Application shell
2. Authentication
3. Tenant creation
4. Company management
5. Branch management
6. Department management
7. User invitations
8. Roles & permissions
9. Audit log
10. Core settings
