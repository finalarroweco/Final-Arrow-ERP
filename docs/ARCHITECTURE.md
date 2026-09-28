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
- Approval workflows
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
- RFQ
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
- Plans
- Subscriptions
- Recurring billing
- Renewals
- Outstanding balances
- Suspension
- Alerts

## 9. Documents & Workflow
- Documents
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
