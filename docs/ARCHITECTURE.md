# Final Arrow ERP — Master Architecture

## 1. Core Platform
- Tenants
- Companies
- Branches
- Departments
- Users
- Roles
- Permissions
- User scopes
- Audit logs
- Notifications
- Attachments
- Implemented review slice: [configured multi-stage approvals](CONFIGURABLE_APPROVALS.md) for purchase issue, expense post and leave approval, with explicit policies, scoped quorums, immutable history and atomic finalization; other adapters remain planned.
- Automation rules
- Localization
- Currencies
- Taxes
- Number sequences

## 2. CRM & Sales
- Leads
- Opportunities
- Customers
- Activities
- Quotations
- Sales orders
- Contracts
- Commissions
- Customer portal

## 3. Finance
- Chart of accounts
- Journals
- Journal entries
- Customer invoices
- Vendor bills
- Payments
- Receivables
- Payables
- Expenses
- Bank reconciliation
- Tax
- P&L
- Balance sheet
- Cash flow

## 4. Procurement & Inventory
- Vendors
- RFQ: implemented request revisions, scoped supplier offers/comparison and explicit DRAFT purchase-order award; see [supplier RFQs](SUPPLIER_RFQS.md). No automatic supplier selection or external sending.
- Purchase orders
- Receipts
- Products
- Variants
- Warehouses
- Stock locations
- Transfers
- Adjustments
- Lots / serial numbers
- Returns
- Reordering

## 5. HR
- Employees
- Departments
- Attendance
- Leave
- Shifts
- Contracts
- Payroll
- Expenses
- Performance
- Employee portal

## 6. Operations
- Projects
- Tasks
- Timesheets
- Services
- Work orders
- Assets
- Maintenance
- Helpdesk
- SLA

## 7. Commerce
- POS
- Orders
- Payments
- Refunds
- Price lists
- Promotions
- Loyalty
- Final Arrow E-commerce integration

## 8. Subscriptions
- Implemented review slice: [Manual subscription register](MANUAL_SUBSCRIPTIONS.md) with immutable customer/scope identity, operator-reported status, plain-text agreement metadata, calendar dates, next review date, full revisions and explicit archive/restore. Source-customer permissions apply to every read and replay. This does not activate, suspend, renew or terminate service.
- Implemented review slice: [configured recurring draft billing](recurring-billing-operator-workspace.md), with versioned exact-price plans, finite UTC calendars, explicit generation/backfill and linked void replacements through real service-source invoices. Manual register status never authorizes charges.
- Planned: background scheduling, the broader subscription platform and automated service entitlements
- Renewals
- Outstanding balances
- Suspension
- Alerts

## 9. Documents & Workflow
- Implemented review slice: scoped internal plain-text reference documents with immutable revisions, explicit archive/restore, durable request recovery, selected-version text/print and metadata CSV. See [Internal text documents](INTERNAL_TEXT_DOCUMENTS.md). This does not complete enterprise DMS.
- Planned: attachments and broader document management
- Templates
- Approval chains
- Business rules
- Automated actions

## 10. Analytics
- Executive dashboard
- Sales
- Finance
- Inventory
- HR
- Projects
- Branch comparison
- Company comparison
- Custom reports

## 11. AI Layer
- Ask ERP
- AI search
- Data analysis
- Report generation
- Document extraction
- Sales assistant
- Finance assistant
- Inventory assistant
- HR assistant
- Management assistant

## Architecture Principles
1. Every business record must be tenant-aware.
2. Company and branch scoping must be enforced server-side.
3. Sensitive actions must be auditable.
4. Financial actions must be deterministic and not depend on LLM guesses.
5. AI executes only through permission-aware tools.
6. Modules remain decoupled through clear service boundaries.

## Manual inventory reordering

The bounded manual reorder implementation lives at `/inventory/reordering`; see [manual reorder policies](MANUAL_REORDER_POLICIES.md). Operators explicitly configure per-item, concrete-branch minimum and target thresholds, with immutable revisions and current policies-first stock reporting. This does not implement procurement planning, supplier selection, purchase recommendations, orders, forecasting or automation. Unit revisions invalidate old thresholds even after an away-and-back unit change.

## Private operational alerts

[Private alert rules](PRIVATE_ALERTS.md) observe ticket deadlines, manual subscription review dates and configured stock shortages on explicit evaluation. They never modify those source records or send externally. History remains subject to current source access; authenticated metadata-only terminal recovery reveals no source counts or details. Background scheduling and provider-backed AI are separate unfinished modules.
