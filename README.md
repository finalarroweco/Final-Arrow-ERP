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
Foundation phase: workspace registration, login, tenant-aware company, branch and department creation, scoped team invitations, membership suspension, invitation revocation, permission checks, and audit events are implemented. The first CRM slice supports company/branch customer records, editing and archiving. Other application modules shown on the home page are planned.

See [implementation notes](docs/IMPLEMENTATION.md) for local setup and current limits.
