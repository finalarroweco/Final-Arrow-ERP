# Final Arrow ERP release status

This repository is an expanding product foundation. The public HTML preview contains sample data and does not save changes. The authenticated app needs PostgreSQL and has not been deployed for public use.

| Area | Current implementation | Remaining work |
| --- | --- | --- |
| Organization & access | Tenants, companies, branches, departments, roles, scoped invitations, team suspension, audit events | Custom role editor, account recovery, verified email, login throttling |
| CRM & sales | Customers, leads, quotes, orders, internal invoices | Contacts, imports, tax, payments, legal documents |
| Purchasing & inventory | Suppliers, purchase orders, full goods receipts, catalog and branch stock ledger | Partial receipts, returns, reservations, valuation |
| Projects | Projects, tasks, employee assignments and status transitions | Dependencies, time tracking, budgets, resource planning |
| Helpdesk | Scoped tickets, optional customer and employee links, priority and status workflow | Conversations, attachments, notifications, customer portal, SLA rules |
| HR | Employee directory and manager-entered leave requests | Leave balance rules, payroll, attendance, separate fingerprint integration |
| Accounting | Internal invoice and expense registers | General ledger, bank reconciliation, taxes, accounts payable and receivable |
| Management | Scoped dashboard and action inbox for leave, expense and purchase drafts | Configurable approval policies, saved reports |
| Other planned modules | Preview cards only | POS, subscriptions, documents, AI and automation |
| Localization | English working app | Complete Arabic interface, right-to-left layout and translation QA |

## Before a real deployment

1. Provision PostgreSQL, secrets, backups, monitoring and a deployment target.
2. Add email verification, account recovery, login abuse controls and an invitation delivery channel.
3. Define financial, HR and document rules with real operating scenarios and test data.
4. Run security, accessibility, performance and end-to-end reviews, including tenant isolation.
5. Enable production registration only after account and abuse controls are ready.

The CI workflow checks migrations, unit tests, database constraints, build and API flows against PostgreSQL. Passing CI means this code slice is internally verified; it does not mean the entire ERP is complete or production ready.
