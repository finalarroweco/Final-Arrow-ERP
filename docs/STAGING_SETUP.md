# Staging setup after the interface review

The HTML walkthrough at `/erp-preview-v2.html` is sample data. It is separate from the authenticated Next.js application. Use the following steps when a staging PostgreSQL database and hosting target are ready; no production data is needed for the first review.

1. Create an isolated PostgreSQL 16 database for staging and a database user limited to that database. Keep its connection URL in the host's secret settings as `DATABASE_URL`; do not commit it.
2. Deploy this repository as a Node.js Next.js application with `npm ci`, `npm run build` and `npm run start`. Use Node.js 24, matching CI. Run `npx prisma migrate deploy` against the staging database before starting the new version.
3. Enable `ALLOW_REGISTRATION=true` only long enough to register the first Owner on the private staging URL; turn it off afterwards. This application does not yet implement email verification, recovery or login throttling, so do not open public registration.
4. Enter a small fictional tenant with two companies and separate branches, then verify Owner, Manager and Viewer access, invitation acceptance, quote to order to invoice, supplier to purchase order to receipt, stock, projects, leave, expenses and tickets.
5. Keep staging separate from production. Back up the database, use HTTPS, and review logs and access controls before inviting real users. Financial and HR modules remain internal prototypes and are not ready for regulatory use.

The current CI uses a temporary PostgreSQL service and verifies migrations and API flows. A successful CI run does not create a persistent database or a public application URL.
