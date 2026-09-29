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
The current slice includes scoped workspaces, team permissions, CRM, sales quotes and orders, internal invoices, suppliers, purchase orders, full goods receipts linked to inventory items, and branch stock movements. The public `/erp-preview.html` page is a sample-data interface walkthrough; it does not write records. Live workflows require PostgreSQL and a configured deployment. Payments, tax accounting, partial receipts, HR and the other modules shown on the home page are planned.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
