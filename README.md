# Final Arrow ERP

AI-powered modular ERP platform by Final Arrow.

## Vision
Build a scalable business operating system with:
- Multi-tenant SaaS architecture
- Multi-company and multi-branch support
- Arabic / English
- Role-based access control
- Audit logs
- CRM
- Sales
- Accounting
- Purchasing
- Inventory
- HR
- Projects
- Subscriptions
- POS
- Helpdesk
- Documents & approvals
- Analytics
- AI & automation

## Initial Architecture
Tenant → Company → Branch → Department → User

## Proposed Stack
- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Redis / background jobs
- Object storage
- AI service layer

## Project Status
The current slice includes scoped workspaces, team permissions, CRM, sales quotes and orders, internal invoices, suppliers, purchase orders, full goods receipts linked to inventory items, branch stock movements, projects with employee task assignments, an employee directory with leave requests, internal expense records, helpdesk tickets, and an action inbox. The public `/erp-preview-v2.html` page is a bilingual sample-data interface walkthrough; it does not write records. Live workflows require PostgreSQL, deployment secrets and a configured hosting target. The HTML preview is maintained separately from the authenticated app and does not automatically reflect every UI change. Payroll, attendance and fingerprint integration, POS, payments, tax accounting, partial receipts, documents, subscriptions and AI automation are not implemented yet.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
See [release status](docs/RELEASE_STATUS.md) for the module inventory and production gates.
See [staging setup](docs/STAGING_SETUP.md) for the later database and hosting connection.
