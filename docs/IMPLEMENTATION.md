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

Accepted quotes can create one internal sales order each. The order stores the customer name, currency, totals and line items as a fixed snapshot of the accepted quote. It keeps company and optional branch scope, and the database enforces a unique source quote plus matching tenant and company foreign keys. `/sales/orders` lists orders within a user's read scope. Payments and tax accounting are not implemented yet.

Sales orders start in NEW. Authorized managers can move them to IN_PROGRESS and then COMPLETED, or cancel a NEW or IN_PROGRESS order. Each transition records its time and actor in the audit log. Conditional updates reject repeated actions and keep completed or cancelled orders closed.

## Internal invoices

`/accounting/invoices` creates one invoice draft from each completed sales order. Customer name, currency, subtotal and lines are copied into an immutable snapshot; invoice numbers are unique per company. Read, create, issue and void permissions respect company and branch scopes. Issuing and voiding are conditional and audited, with a required reason for voiding. These are internal billing records without tax, payment collection, credit notes or legal PDF documents; they are not tax-compliant invoices.

## Company settings

Owners can set a three-letter base currency when creating a company and update its name, legal name and currency later. New quotes copy the company's current currency. Quotes and sales orders already created keep their original currency as part of their records; changing company settings never converts historical amounts. Updates are audited and existing Owner roles receive the new permission through a migration.

## Dashboard

`/dashboard` shows active customer count and lead, quote and order status counts for a selected company. Each metric checks its own read permission. Branch-scoped users see only records assigned to their branches, never company-wide or sibling-branch records. Metrics without permission are omitted, and the endpoint rejects requests with no readable modules. Counts are operational activity, not financial revenue.

## Supplier directory

`/purchasing/suppliers` manages company-wide or branch-specific supplier contact records. Codes are unique per company. Creation, editing, archiving and restoration are independently permissioned and audited. Branch readers see only suppliers assigned to their branch; company-wide suppliers require company-level access. The migration grants the new permissions to existing Owner, Manager and Viewer roles. Purchase requests and payables are future work.

`/purchasing/orders` creates draft purchase orders from an active supplier in the same company. Branch orders can use a supplier assigned to their branch or a company-wide supplier; company-wide orders use only company-wide suppliers. The order records the supplier name, currency, line amounts and subtotal as a snapshot. Authorized managers can issue or cancel a draft. Issuing is an internal status change and does not send an email. An issued order is received through a goods receipt that maps every line to an active inventory item in the receiving branch. Receipt creation changes the order status, adds stock movements, and records an audit event in one transaction. Company-wide orders require a receiving branch choice; branch orders must be received in their own branch. Receipt is full and one-time; partial deliveries, tax and payables remain future work.

## Inventory item catalog

`/inventory/items` maintains company-wide or branch-specific SKU records with a name, unit and optional description. A SKU is unique per company; edits, archiving and restoration are permissioned and audited. A branch reader sees only its branch's catalog records. Purchase order lines can be mapped to SKUs at receipt time.

`/inventory/stock` records manual additions and removals of quantities in each branch. A company-wide item can be stocked in any branch of its company; a branch item can be stocked only in its own branch. Balances use three decimal places and cannot fall below zero. Every adjustment requires a reason, creates an immutable movement record and an audit event, and checks branch-level read or adjustment permissions independently. A database constraint rejects negative balances and mismatched movement directions. A full goods receipt also creates positive movements linked to its lines; the old status-only receive action is disabled.

`/sales/quotes` creates draft customer quotes with one or more line items. Each quote uses its company's base currency, calculates line amounts and subtotal on the server with exact decimal arithmetic, and records an audit event. A branch quote may reference a customer from the same branch or a company-wide customer; a company-wide quote may reference only a company-wide customer. Read, create, update, send and decision permissions are checked independently, with branch-limited listings. A draft's notes and lines can be replaced atomically; the total is recalculated on the server, and conditional status checks prevent editing after sending. A draft can be marked sent, then accepted or rejected; the transition is conditional and audited so concurrent or repeated actions cannot change a closed quote. Marking sent records an internal status and does not send an email. Tax, discounts and PDF export remain future work.

## Projects

`/projects` manages company-wide or branch-specific projects and tasks. Projects move through planned, active, on-hold, completed and cancelled states. Tasks can be started, completed or cancelled while a project is active; a project cannot complete with open tasks. Read, create and manage permissions follow company and branch scopes. Changes are audited; due dates are optional.

## Employee directory

`/hr/employees` stores staff codes, names, job titles, contact information and optional start dates by company or branch. Owners and Managers can read, create and manage staff; Viewers do not receive employee access by default. Records can be deactivated and reactivated. This is a directory, not payroll, leave, attendance or fingerprint integration.

## Internal expenses

`/accounting/expenses` records company or branch spending in the company base currency. A positive amount, category, description and date are required. Drafts can be posted once or voided with a reason; posted records can also be voided. Status changes are audited and conditional. This is an internal expense register, not a general ledger, tax system, payment execution or approval chain.
