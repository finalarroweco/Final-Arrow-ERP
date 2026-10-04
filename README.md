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
The current application includes scoped companies/branches and team permissions, CRM, quotes/orders/invoices, purchasing and full goods receipts, inventory movements, projects/time, HR/leave/manual attendance/payroll, expenses/helpdesk/approvals, POS/kitchen and manual-ledger financial reports with company period locks. `/erp-preview-v6.html` is the latest bilingual sample-data walkthrough; it does not save records. Live workflows require a dedicated PostgreSQL database and a configured Next.js host. Database activation is authorized and its connection/migration setup is ready; the persistent ERP provider project and hosting target are still pending. Tax accounting, automatic ledger posting, real payment/device integrations and other production gaps are listed in the release status.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
See [release status](docs/RELEASE_STATUS.md) for the module inventory and production gates.
See [staging setup](docs/STAGING_SETUP.md) for the later database and hosting connection.
