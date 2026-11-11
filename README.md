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

## Stack and planned infrastructure
- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Redis / background jobs (planned)
- Object storage (planned)
- AI service layer (planned)

## Project Status
The documented hosted application is https://final-arrow-erp.vercel.app/dashboard. Its deployed revision and database migration state must be verified separately; features on this review branch are not evidence that they are live. The repository implements scoped organization/team access, CRM and sales, internal invoices and purchase/expense/POS accounting with optional Oman VAT, partial purchase receipts/stock returns, completed branch stock transfers with paired corrections, manual sales deliveries and usable-stock returns with explicit full-hold delivery, customer and supplier settlements, explicit partial/split bank reconciliation with retained internal snapshots and safe request recovery, inventory, projects/time, HR/payroll, helpdesk, POS/kitchen, source-linked ledger posting, financial reports and period locks. Arabic/English interfaces and offline account recovery are available; public registration is closed.

`/erp-preview-v6.html` is a separate sample-data walkthrough and does not save records or receive application updates automatically. CSV customer/supplier/item imports, private saved balance/aging and document-register report filters, internal plain-text documents with immutable revisions and archive/restore, a manual customer subscription register with explicit status/review dates, company payment-term templates, audited invoice/receipt payment-term amendments, and explicit sales-order-linked manual stock holds are implemented. Statutory tax documents/filing, inclusive tax pricing, email verification/recovery, external payment/device integrations and operational acceptance remain unfinished. The product is a draft ERP foundation, not a completed regulatory accounting system.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
See [release status](docs/RELEASE_STATUS.md) for the module inventory and production gates.
See [release acceptance](docs/RELEASE_ACCEPTANCE.md) for evidence and sign-off required before live use.
See [staging setup](docs/STAGING_SETUP.md) for database/hosting setup and live review limits.
