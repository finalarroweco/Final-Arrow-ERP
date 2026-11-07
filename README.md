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
The authenticated application is deployed at https://final-arrow-erp.vercel.app/dashboard with a dedicated PostgreSQL database. It includes scoped organization/team access, CRM and sales, internal invoices with optional Oman VAT, partial purchase receipts/stock returns, customer and supplier settlements, bank reconciliation, inventory, projects/time, HR/payroll, helpdesk, POS/kitchen, source-linked ledger posting, financial reports and period locks. Arabic/English interfaces and offline account recovery are available; public registration is closed.

`/erp-preview-v6.html` is a separate sample-data walkthrough and does not save records or receive application updates automatically. Purchase/expense/POS VAT, statutory tax documents, email verification/recovery, external payment/device integrations and operational acceptance remain unfinished. The product is a draft ERP foundation, not a completed regulatory accounting system.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
See [release status](docs/RELEASE_STATUS.md) for the module inventory and production gates.
See [staging setup](docs/STAGING_SETUP.md) for database/hosting setup and live review limits.
