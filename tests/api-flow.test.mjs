import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:3217";
const suffix = () => randomUUID().slice(0, 8);
const password = "Long-test-password-2026";

async function jsonResponse(response, path) {
  const body = await response.text();
  assert.ok(body, `${path} returned empty body (HTTP ${response.status})`);
  try { return JSON.parse(body); }
  catch { throw new Error(`${path} returned non-JSON body (HTTP ${response.status}): ${body.slice(0, 250)}`); }
}

async function post(path, body, cookie) {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await jsonResponse(response, path), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function get(path, cookie) {
  const response = await fetch(origin + path, { headers: { Cookie: cookie } });
  return { status: response.status, data: await jsonResponse(response, path) };
}

async function patch(path, body, cookie) {
  const response = await fetch(origin + path, {
    method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await jsonResponse(response, path) };
}

test("invitation is single-use and a branch viewer sees only their company and branch", { timeout: 90000 }, async () => {
  const server = spawn("./node_modules/.bin/next", ["start", "-p", "3217"], {
    env: { ...process.env, ALLOW_REGISTRATION: "true" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (server.exitCode !== null) throw new Error("Server exited before startup");
      try { const response = await fetch(origin); if (response.ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(ready, true, "Next.js server did not start");

    const owner = await post("/api/auth/register", {
      name: "Owner", email: `owner-${suffix()}@example.invalid`, password,
      organization: "Test group", slug: `group-${suffix()}`,
    });
    assert.equal(owner.status, 201);
    assert.ok(owner.cookie);
    const tenantId = owner.data.tenantId;
    const companyA = await post("/api/companies", { tenantId, name: "Company A", code: "CMPA" }, owner.cookie);
    const companyB = await post("/api/companies", { tenantId, name: "Company B", code: "CMPB" }, owner.cookie);
    assert.equal(companyA.status, 201);
    assert.equal(companyB.status, 201);
    const branchA = await post("/api/branches", {
      tenantId, companyId: companyA.data.company.id, name: "Branch A", code: "BRA",
    }, owner.cookie);
    const branchB = await post("/api/branches", {
      tenantId, companyId: companyA.data.company.id, name: "Branch B", code: "BRB",
    }, owner.cookie);
    assert.equal(branchA.status, 201);
    assert.equal(branchB.status, 201);
    const customerA = await post("/api/customers", {
      tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      code: "CUST-A", displayName: "Branch A Customer",
    }, owner.cookie);
    const customerB = await post("/api/customers", {
      tenantId, companyId: companyA.data.company.id, branchId: branchB.data.branch.id,
      code: "CUST-B", displayName: "Branch B Customer",
    }, owner.cookie);
    const sharedCustomer = await post("/api/customers", {
      tenantId, companyId: companyA.data.company.id, code: "CUST-C", displayName: "Company Customer",
    }, owner.cookie);
    assert.equal(customerA.status, 201);
    assert.equal(customerB.status, 201);
    assert.equal(sharedCustomer.status, 201);

    const email = `viewer-${suffix()}@example.invalid`;
    const invitation = await post("/api/invitations", {
      tenantId, email, role: "Viewer",
      scope: { type: "BRANCH", companyId: companyA.data.company.id, branchId: branchA.data.branch.id },
    }, owner.cookie);
    assert.equal(invitation.status, 201);
    const token = invitation.data.path.split("/").at(-1);
    const wrongAccount = await post("/api/invitations/accept", { token }, owner.cookie);
    assert.equal(wrongAccount.status, 403);
    const accepted = await post("/api/invitations/accept", { token, name: "Viewer", password });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.cookie);
    const replay = await post("/api/invitations/accept", { token });
    assert.equal(replay.status, 410);

    const branches = await get(`/api/branches?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(branches.status, 200);
    assert.deepEqual(branches.data.branches.map((b) => b.id), [branchA.data.branch.id]);
    const companies = await get(`/api/companies?tenantId=${tenantId}`, accepted.cookie);
    assert.equal(companies.status, 200);
    assert.deepEqual(companies.data.companies.map((c) => c.id), [companyA.data.company.id]);
    const customerList = await get(`/api/customers?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(customerList.status, 200);
    assert.deepEqual(customerList.data.customers.map((c) => c.id), [customerA.data.customer.id]);
    const viewerEdit = await patch(`/api/customers/${customerA.data.customer.id}`, {
      tenantId, action: "update", displayName: "Unauthorized",
    }, accepted.cookie);
    assert.equal(viewerEdit.status, 403);
    const forbidden = await post("/api/branches", {
      tenantId, companyId: companyB.data.company.id, name: "No access", code: "DENY",
    }, accepted.cookie);
    assert.equal(forbidden.status, 403);

    const managerInvite = await post("/api/invitations", {
      tenantId, email: `manager-${suffix()}@example.invalid`, role: "Manager",
      scope: { type: "BRANCH", companyId: companyA.data.company.id, branchId: branchA.data.branch.id },
    }, owner.cookie);
    assert.equal(managerInvite.status, 201);
    const manager = await post("/api/invitations/accept", {
      token: managerInvite.data.path.split("/").at(-1), name: "Manager", password,
    });
    assert.equal(manager.status, 200);
    const managerCustomer = await post("/api/customers", {
      tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      code: "CUST-D", displayName: "Managed Customer",
    }, manager.cookie);
    assert.equal(managerCustomer.status, 201);
    const managerWrongBranch = await post("/api/customers", {
      tenantId, companyId: companyA.data.company.id, branchId: branchB.data.branch.id,
      code: "CUST-E", displayName: "Wrong branch",
    }, manager.cookie);
    assert.equal(managerWrongBranch.status, 403);
    const managerUpdate = await patch(`/api/customers/${managerCustomer.data.customer.id}`, {
      tenantId, action: "update", displayName: "Updated Customer",
    }, manager.cookie);
    assert.equal(managerUpdate.status, 200);
    const managerArchive = await patch(`/api/customers/${managerCustomer.data.customer.id}`, {
      tenantId, action: "archive", archived: true,
    }, manager.cookie);
    assert.equal(managerArchive.status, 200);
    const activeCustomers = await get(`/api/customers?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, manager.cookie);
    assert.equal(activeCustomers.data.customers.some((c) => c.id === managerCustomer.data.customer.id), false);
    const archivedCustomers = await get(`/api/customers?tenantId=${tenantId}&companyId=${companyA.data.company.id}&archived=true`, manager.cookie);
    assert.deepEqual(archivedCustomers.data.customers.map((c) => c.id), [managerCustomer.data.customer.id]);

    const leadA = await post("/api/leads", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, code: "LEAD-A", displayName: "Branch A Lead" }, owner.cookie);
    const leadB = await post("/api/leads", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, code: "LEAD-B", displayName: "Branch B Lead" }, owner.cookie);
    assert.equal(leadA.status, 201);
    assert.equal(leadB.status, 201);
    const viewerLeads = await get(`/api/leads?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(viewerLeads.status, 200);
    assert.deepEqual(viewerLeads.data.leads.map((lead) => lead.id), [leadA.data.lead.id]);
    assert.equal((await patch(`/api/leads/${leadA.data.lead.id}`, { tenantId, stage: "QUALIFIED" }, accepted.cookie)).status, 403);
    assert.equal((await post(`/api/leads/${leadB.data.lead.id}/convert`, { tenantId, customerCode: "LEAD-B" }, manager.cookie)).status, 403);
    assert.equal((await patch(`/api/leads/${leadA.data.lead.id}`, { tenantId, stage: "QUALIFIED" }, manager.cookie)).status, 200);
    const converted = await post(`/api/leads/${leadA.data.lead.id}/convert`, { tenantId, customerCode: "LEAD-A" }, manager.cookie);
    assert.equal(converted.status, 201);
    assert.equal(converted.data.customer.displayName, "Branch A Lead");
    assert.equal((await post(`/api/leads/${leadA.data.lead.id}/convert`, { tenantId, customerCode: "LEAD-A" }, manager.cookie)).status, 409);
    assert.equal((await patch(`/api/leads/${leadA.data.lead.id}`, { tenantId, stage: "LOST" }, manager.cookie)).status, 409);
    const convertedList = await get(`/api/customers?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, manager.cookie);
    assert.equal(convertedList.data.customers.filter((customer) => customer.id === converted.data.customer.id).length, 1);

    const quoteBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      customerId: customerA.data.customer.id, number: "QT-001",
      lines: [{ description: "Consulting", quantity: 2, unitPrice: "1.250" },
        { description: "Implementation", quantity: 1, unitPrice: "3.000" }] };
    assert.equal((await post("/api/quotes", quoteBody, accepted.cookie)).status, 403);
    const wrongCustomerQuote = await post("/api/quotes", { ...quoteBody,
      customerId: customerB.data.customer.id }, manager.cookie);
    assert.equal(wrongCustomerQuote.status, 409);
    const quote = await post("/api/quotes", quoteBody, manager.cookie);
    assert.equal(quote.status, 201);
    assert.equal(quote.data.quote.subtotal, "5.5");
    assert.equal(quote.data.quote.currency, "OMR");
    assert.equal(quote.data.quote.lines[0].amount, "2.5");
    assert.equal((await post("/api/quotes", quoteBody, manager.cookie)).status, 409);
    const visibleQuotes = await get(`/api/quotes?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(visibleQuotes.status, 200);
    assert.deepEqual(visibleQuotes.data.quotes.map((item) => item.id), [quote.data.quote.id]);
    const quoteB = await post("/api/quotes", { ...quoteBody, branchId: branchB.data.branch.id,
      customerId: customerB.data.customer.id, number: "QT-002" }, owner.cookie);
    assert.equal(quoteB.status, 201);
    const restrictedQuotes = await get(`/api/quotes?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.deepEqual(restrictedQuotes.data.quotes.map((item) => item.id), [quote.data.quote.id]);
    const editPath = `/api/quotes/${quote.data.quote.id}`;
    const editedLines = [{ description: "Revised service", quantity: 3, unitPrice: "2.125" }];
    assert.equal((await patch(editPath, { tenantId, lines: editedLines }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/quotes/${quoteB.data.quote.id}`, { tenantId, lines: editedLines }, manager.cookie)).status, 403);
    const revisedQuote = await patch(editPath, { tenantId, notes: "Updated draft", lines: editedLines }, manager.cookie);
    assert.equal(revisedQuote.status, 200);
    assert.equal(revisedQuote.data.quote.subtotal, "6.375");
    assert.equal(revisedQuote.data.quote.lines.length, 1);
    assert.equal(revisedQuote.data.quote.lines[0].amount, "6.375");
    const statusPath = `/api/quotes/${quote.data.quote.id}/status`;
    assert.equal((await patch(statusPath, { tenantId, action: "send" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/quotes/${quoteB.data.quote.id}/status`, { tenantId, action: "send" }, manager.cookie)).status, 403);
    assert.equal((await patch(statusPath, { tenantId, action: "accept" }, manager.cookie)).status, 409);
    const sentQuote = await patch(statusPath, { tenantId, action: "send" }, manager.cookie);
    assert.equal(sentQuote.status, 200);
    assert.equal(sentQuote.data.quote.status, "SENT");
    assert.ok(sentQuote.data.quote.sentAt);
    assert.equal((await patch(editPath, { tenantId, lines: quoteBody.lines }, manager.cookie)).status, 409);
    assert.equal((await patch(statusPath, { tenantId, action: "send" }, manager.cookie)).status, 409);
    const acceptedQuote = await patch(statusPath, { tenantId, action: "accept" }, manager.cookie);
    assert.equal(acceptedQuote.status, 200);
    assert.equal(acceptedQuote.data.quote.status, "ACCEPTED");
    assert.ok(acceptedQuote.data.quote.decidedAt);
    assert.equal((await patch(statusPath, { tenantId, action: "reject" }, manager.cookie)).status, 409);
    const rejectedPath = `/api/quotes/${quoteB.data.quote.id}/status`;
    assert.equal((await patch(rejectedPath, { tenantId, action: "send" }, owner.cookie)).status, 200);
    assert.equal((await patch(rejectedPath, { tenantId, action: "reject" }, owner.cookie)).status, 200);
    const orderPath = `/api/quotes/${quote.data.quote.id}/order`;
    assert.equal((await post(orderPath, { tenantId, number: "SO-001" }, accepted.cookie)).status, 403);
    assert.equal((await post(`/api/quotes/${quoteB.data.quote.id}/order`, { tenantId, number: "SO-002" }, manager.cookie)).status, 403);
    assert.equal((await post(`/api/quotes/${quoteB.data.quote.id}/order`, { tenantId, number: "SO-002" }, owner.cookie)).status, 409);
    const order = await post(orderPath, { tenantId, number: "SO-001" }, manager.cookie);
    assert.equal(order.status, 201);
    assert.equal(order.data.order.subtotal, "6.375");
    assert.equal(order.data.order.lines.length, 1);
    assert.equal(order.data.order.lines[0].description, "Revised service");
    assert.equal((await post(orderPath, { tenantId, number: "SO-003" }, manager.cookie)).status, 409);
    const ownerOrderList = await get(`/api/orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, owner.cookie);
    assert.equal(ownerOrderList.status, 200);
    assert.deepEqual(ownerOrderList.data.orders.map((item) => item.id), [order.data.order.id]);
    const viewerOrderList = await get(`/api/orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.deepEqual(viewerOrderList.data.orders.map((item) => item.id), [order.data.order.id]);
    assert.equal((await patch(`/api/customers/${customerA.data.customer.id}`, {
      tenantId, action: "update", displayName: "Renamed Customer",
    }, manager.cookie)).status, 200);
    const snapshot = await get(`/api/orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, manager.cookie);
    assert.equal(snapshot.data.orders[0].customerName, "Branch A Customer");
    const orderStatusPath = `/api/orders/${order.data.order.id}/status`;
    assert.equal((await patch(orderStatusPath, { tenantId, action: "start" }, accepted.cookie)).status, 403);
    assert.equal((await patch(orderStatusPath, { tenantId, action: "complete" }, manager.cookie)).status, 409);
    const startedOrder = await patch(orderStatusPath, { tenantId, action: "start" }, manager.cookie);
    assert.equal(startedOrder.status, 200);
    assert.equal(startedOrder.data.order.status, "IN_PROGRESS");
    assert.ok(startedOrder.data.order.startedAt);
    assert.equal((await patch(orderStatusPath, { tenantId, action: "start" }, manager.cookie)).status, 409);
    const finishedOrder = await patch(orderStatusPath, { tenantId, action: "complete" }, manager.cookie);
    assert.equal(finishedOrder.status, 200);
    assert.equal(finishedOrder.data.order.status, "COMPLETED");
    assert.ok(finishedOrder.data.order.completedAt);
    assert.equal((await patch(orderStatusPath, { tenantId, action: "cancel" }, manager.cookie)).status, 409);
    const quoteC = await post("/api/quotes", { ...quoteBody, branchId: branchB.data.branch.id,
      customerId: customerB.data.customer.id, number: "QT-003" }, owner.cookie);
    assert.equal(quoteC.status, 201);
    const quoteCStatus = `/api/quotes/${quoteC.data.quote.id}/status`;
    assert.equal((await patch(quoteCStatus, { tenantId, action: "send" }, owner.cookie)).status, 200);
    assert.equal((await patch(quoteCStatus, { tenantId, action: "accept" }, owner.cookie)).status, 200);
    const orderB = await post(`/api/quotes/${quoteC.data.quote.id}/order`, { tenantId, number: "SO-002" }, owner.cookie);
    assert.equal(orderB.status, 201);
    const orderBStatus = `/api/orders/${orderB.data.order.id}/status`;
    assert.equal((await patch(orderBStatus, { tenantId, action: "start" }, manager.cookie)).status, 403);
    const cancelledOrder = await patch(orderBStatus, { tenantId, action: "cancel" }, owner.cookie);
    assert.equal(cancelledOrder.status, 200);
    assert.equal(cancelledOrder.data.order.status, "CANCELLED");
    assert.ok(cancelledOrder.data.order.cancelledAt);
    assert.equal((await patch(orderBStatus, { tenantId, action: "start" }, owner.cookie)).status, 409);
    const visibleOrders = await get(`/api/orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.deepEqual(visibleOrders.data.orders.map((item) => item.id), [order.data.order.id]);
    const invoicePath = `/api/orders/${order.data.order.id}/invoice`;
    assert.equal((await post(invoicePath, { tenantId, number: "INV-001" }, accepted.cookie)).status, 403);
    assert.equal((await post(`/api/orders/${orderB.data.order.id}/invoice`, { tenantId, number: "INV-002" }, manager.cookie)).status, 403);
    assert.equal((await post(`/api/orders/${orderB.data.order.id}/invoice`, { tenantId, number: "INV-002" }, owner.cookie)).status, 409);
    const invoice = await post(invoicePath, { tenantId, number: "INV-001" }, manager.cookie);
    assert.equal(invoice.status, 201);
    assert.equal(invoice.data.invoice.customerName, "Branch A Customer");
    assert.equal(invoice.data.invoice.subtotal, "6.375");
    assert.equal(invoice.data.invoice.lines[0].description, "Revised service");
    assert.equal((await post(invoicePath, { tenantId, number: "INV-003" }, manager.cookie)).status, 409);
    const invoiceListPath = `/api/invoices?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(invoiceListPath, accepted.cookie)).data.invoices.map((item) => item.id), [invoice.data.invoice.id]);
    assert.equal((await get(`/api/invoices?tenantId=${tenantId}&companyId=${companyB.data.company.id}`, accepted.cookie)).status, 403);
    const invoiceStatusPath = `/api/invoices/${invoice.data.invoice.id}/status`;
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, accepted.cookie)).status, 403);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void" }, manager.cookie)).status, 400);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 200);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 409);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void", reason: "Entry correction" }, manager.cookie)).status, 200);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 409);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void", reason: "Again" }, manager.cookie)).status, 409);
    const companySettingsPath = `/api/companies/${companyA.data.company.id}`;
    const settings = { tenantId, name: "Company A Updated", legalName: "Company A LLC", baseCurrency: "JOD" };
    assert.equal((await patch(companySettingsPath, settings, accepted.cookie)).status, 403);
    assert.equal((await patch(companySettingsPath, settings, manager.cookie)).status, 403);
    assert.equal((await patch(companySettingsPath, { ...settings, baseCurrency: "INVALID" }, owner.cookie)).status, 400);
    const updatedCompany = await patch(companySettingsPath, settings, owner.cookie);
    assert.equal(updatedCompany.status, 200);
    assert.equal(updatedCompany.data.company.baseCurrency, "JOD");
    const nextQuote = await post("/api/quotes", { ...quoteBody, number: "QT-004" }, owner.cookie);
    assert.equal(nextQuote.status, 201);
    assert.equal(nextQuote.data.quote.currency, "JOD");
    const previousOrder = await get(`/api/orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, owner.cookie);
    assert.equal(previousOrder.data.orders.find((item) => item.id === order.data.order.id).currency, "OMR");
    const companyC = await post("/api/companies", { tenantId, name: "Company C", code: "CMPC", baseCurrency: "JOD" }, owner.cookie);
    assert.equal(companyC.status, 201);
    assert.equal(companyC.data.company.baseCurrency, "JOD");
    const dashboardPath = `/api/dashboard?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    const viewerDashboard = await get(dashboardPath, accepted.cookie);
    assert.equal(viewerDashboard.status, 200);
    assert.equal(viewerDashboard.data.customers, 2);
    assert.equal(viewerDashboard.data.leads.WON, 1);
    assert.equal(viewerDashboard.data.leads.NEW, 0);
    assert.equal(viewerDashboard.data.quotes.ACCEPTED, 1);
    assert.equal(viewerDashboard.data.quotes.REJECTED, 0);
    assert.equal(viewerDashboard.data.orders.COMPLETED, 1);
    assert.equal(viewerDashboard.data.orders.CANCELLED, 0);
    const ownerDashboard = await get(dashboardPath, owner.cookie);
    assert.equal(ownerDashboard.status, 200);
    assert.equal(ownerDashboard.data.customers, 4);
    assert.equal(ownerDashboard.data.orders.CANCELLED, 1);
    assert.equal((await get(`/api/dashboard?tenantId=${tenantId}&companyId=${companyB.data.company.id}`, accepted.cookie)).status, 403);

    const supplierA = await post("/api/suppliers", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, code: "SUP-A", displayName: "Branch A Supplier" }, owner.cookie);
    const supplierB = await post("/api/suppliers", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, code: "SUP-B", displayName: "Branch B Supplier" }, owner.cookie);
    const sharedSupplier = await post("/api/suppliers", { tenantId, companyId: companyA.data.company.id,
      code: "SUP-C", displayName: "Company Supplier" }, owner.cookie);
    assert.equal(supplierA.status, 201);
    assert.equal(supplierB.status, 201);
    assert.equal(sharedSupplier.status, 201);
    assert.equal((await post("/api/suppliers", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, code: "SUP-D", displayName: "Viewer Supplier" }, accepted.cookie)).status, 403);
    assert.equal((await post("/api/suppliers", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, code: "SUP-E", displayName: "Wrong Branch" }, manager.cookie)).status, 403);
    const supplierListPath = `/api/suppliers?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    const viewerSuppliers = await get(supplierListPath, accepted.cookie);
    assert.equal(viewerSuppliers.status, 200);
    assert.deepEqual(viewerSuppliers.data.suppliers.map((item) => item.id), [supplierA.data.supplier.id]);
    const supplierPath = `/api/suppliers/${supplierA.data.supplier.id}`;
    assert.equal((await patch(supplierPath, { tenantId, action: "update", displayName: "Viewer Edit" }, accepted.cookie)).status, 403);
    const editedSupplier = await patch(supplierPath, { tenantId, action: "update", displayName: "Updated Supplier" }, manager.cookie);
    assert.equal(editedSupplier.status, 200);
    assert.equal(editedSupplier.data.supplier.displayName, "Updated Supplier");
    assert.equal((await patch(supplierPath, { tenantId, action: "archive", archived: true }, manager.cookie)).status, 200);
    assert.equal((await patch(supplierPath, { tenantId, action: "update", displayName: "Blocked" }, manager.cookie)).status, 409);
    assert.deepEqual((await get(supplierListPath, accepted.cookie)).data.suppliers, []);
    const archivedSupplier = await get(`${supplierListPath}&archived=true`, accepted.cookie);
    assert.deepEqual(archivedSupplier.data.suppliers.map((item) => item.id), [supplierA.data.supplier.id]);
    assert.equal((await patch(supplierPath, { tenantId, action: "archive", archived: false }, manager.cookie)).status, 200);

    const purchaseOrderBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      supplierId: supplierA.data.supplier.id, number: "PO-001", lines: [{ description: "Packaging", quantity: 3, unitPrice: "2.125" }] };
    assert.equal((await post("/api/purchase-orders", purchaseOrderBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/purchase-orders", { ...purchaseOrderBody,
      branchId: branchB.data.branch.id, number: "PO-OTHER" }, manager.cookie)).status, 403);
    assert.equal((await post("/api/purchase-orders", { ...purchaseOrderBody,
      supplierId: supplierB.data.supplier.id, number: "PO-WRONG" }, manager.cookie)).status, 409);
    assert.equal((await post("/api/purchase-orders", { ...purchaseOrderBody,
      companyId: companyB.data.company.id, number: "PO-CROSS" }, owner.cookie)).status, 404);
    const purchaseOrder = await post("/api/purchase-orders", purchaseOrderBody, manager.cookie);
    assert.equal(purchaseOrder.status, 201);
    assert.equal(purchaseOrder.data.order.subtotal, "6.375");
    assert.equal(purchaseOrder.data.order.supplierName, "Updated Supplier");
    assert.equal((await post("/api/purchase-orders", purchaseOrderBody, manager.cookie)).status, 409);
    const purchaseOrdersPath = `/api/purchase-orders?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(purchaseOrdersPath, accepted.cookie)).data.orders.map((item) => item.id),
      [purchaseOrder.data.order.id]);
    const purchaseStatusPath = `/api/purchase-orders/${purchaseOrder.data.order.id}/status`;
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "issue" }, accepted.cookie)).status, 403);
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "receive" }, manager.cookie)).status, 400);
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 200);
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 409);
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "receive" }, manager.cookie)).status, 400);
    assert.equal((await patch(purchaseStatusPath, { tenantId, action: "cancel" }, manager.cookie)).status, 409);

    const itemA = await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, sku: "ITEM-A", name: "Branch A Item", unit: "EA" }, owner.cookie);
    const itemB = await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, sku: "ITEM-B", name: "Branch B Item", unit: "KG" }, owner.cookie);
    const sharedItem = await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      sku: "ITEM-C", name: "Company Item", unit: "EA" }, owner.cookie);
    assert.equal(itemA.status, 201);
    assert.equal(itemB.status, 201);
    assert.equal(sharedItem.status, 201);
    assert.equal((await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, sku: "ITEM-A", name: "Duplicate Item", unit: "EA" }, owner.cookie)).status, 409);
    assert.equal((await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, sku: "ITEM-D", name: "Viewer Item", unit: "EA" }, accepted.cookie)).status, 403);
    assert.equal((await post("/api/inventory/items", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, sku: "ITEM-E", name: "Wrong Branch", unit: "EA" }, manager.cookie)).status, 403);
    const itemListPath = `/api/inventory/items?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(itemListPath, accepted.cookie)).data.items.map((item) => item.id), [itemA.data.item.id]);
    const itemPath = `/api/inventory/items/${itemA.data.item.id}`;
    assert.equal((await patch(itemPath, { tenantId, action: "update", name: "Viewer Edit" }, accepted.cookie)).status, 403);
    assert.equal((await patch(itemPath, { tenantId, action: "update", name: "Updated Item", unit: "KG" }, manager.cookie)).status, 200);
    assert.equal((await patch(itemPath, { tenantId, action: "archive", archived: true }, manager.cookie)).status, 200);
    assert.equal((await patch(itemPath, { tenantId, action: "update", name: "Blocked" }, manager.cookie)).status, 409);
    assert.deepEqual((await get(itemListPath, accepted.cookie)).data.items, []);
    assert.deepEqual((await get(`${itemListPath}&archived=true`, accepted.cookie)).data.items.map((item) => item.id),
      [itemA.data.item.id]);
    assert.equal((await patch(itemPath, { tenantId, action: "archive", archived: false }, manager.cookie)).status, 200);

    const stockPath = `/api/inventory/stock?tenantId=${tenantId}&companyId=${companyA.data.company.id}&branchId=${branchA.data.branch.id}`;
    assert.equal((await get(stockPath, accepted.cookie)).status, 200);
    assert.equal((await get(stockPath.replace(branchA.data.branch.id, branchB.data.branch.id), accepted.cookie)).status, 403);
    const adjust = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      itemId: itemA.data.item.id, action: "in", quantity: "5.500", reason: "Opening count" };
    assert.equal((await post("/api/inventory/stock", adjust, accepted.cookie)).status, 403);
    assert.equal((await post("/api/inventory/stock", { ...adjust, branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/inventory/stock", { ...adjust, itemId: itemB.data.item.id }, manager.cookie)).status, 409);
    assert.equal((await post("/api/inventory/stock", { ...adjust, quantity: "0" }, manager.cookie)).status, 400);
    assert.equal((await post("/api/inventory/stock", { ...adjust, action: "out" }, manager.cookie)).status, 409);
    assert.equal((await post("/api/inventory/stock", adjust, manager.cookie)).status, 201);
    assert.equal((await post("/api/inventory/stock", { ...adjust, itemId: sharedItem.data.item.id,
      quantity: "1.250" }, manager.cookie)).status, 201);
    assert.equal((await post("/api/inventory/stock", { ...adjust, action: "out", quantity: "2.125",
      reason: "Damaged items" }, manager.cookie)).status, 201);
    assert.equal((await post("/api/inventory/stock", { ...adjust, action: "out", quantity: "4.000",
      reason: "Overdraw" }, manager.cookie)).status, 409);
    const stock = await get(stockPath, accepted.cookie);
    assert.equal(stock.status, 200);
    assert.equal(stock.data.balances.find((balance) => balance.itemId === itemA.data.item.id).quantity, "3.375");
    assert.equal(stock.data.balances.find((balance) => balance.itemId === sharedItem.data.item.id).quantity, "1.25");
    assert.equal(stock.data.movements.length, 3);

    const receiptPath = `/api/purchase-orders/${purchaseOrder.data.order.id}/receive`;
    const receiptBody = { tenantId, branchId: branchA.data.branch.id,
      lines: [{ orderLineId: purchaseOrder.data.order.lines[0].id, itemId: itemA.data.item.id }] };
    assert.equal((await post(receiptPath, receiptBody, accepted.cookie)).status, 403);
    assert.equal((await post(receiptPath, { ...receiptBody, branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post(receiptPath, { ...receiptBody, lines: [] }, manager.cookie)).status, 400);
    assert.equal((await post(receiptPath, { ...receiptBody,
      lines: [{ ...receiptBody.lines[0], itemId: itemB.data.item.id }] }, manager.cookie)).status, 409);
    assert.equal((await get(stockPath, accepted.cookie)).data.balances.find((balance) =>
      balance.itemId === itemA.data.item.id).quantity, "3.375");
    const receipt = await post(receiptPath, receiptBody, manager.cookie);
    assert.equal(receipt.status, 201);
    assert.equal(receipt.data.receipt.lines.length, 1);
    assert.equal((await post(receiptPath, receiptBody, manager.cookie)).status, 409);
    assert.equal((await get(stockPath, accepted.cookie)).data.balances.find((balance) =>
      balance.itemId === itemA.data.item.id).quantity, "6.375");
    assert.equal((await get(stockPath, accepted.cookie)).data.movements.length, 4);

    const projectBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      code: "PRJ-A", name: "Branch A project", dueDate: "2026-12-31" };
    assert.equal((await post("/api/projects", projectBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/projects", { ...projectBody, branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/projects", { ...projectBody, dueDate: "2026-02-30" }, manager.cookie)).status, 400);
    const projectA = await post("/api/projects", projectBody, manager.cookie);
    const projectB = await post("/api/projects", { ...projectBody, branchId: branchB.data.branch.id,
      code: "PRJ-B", name: "Branch B project" }, owner.cookie);
    const companyProject = await post("/api/projects", { ...projectBody, branchId: null,
      code: "PRJ-C", name: "Company project" }, owner.cookie);
    assert.equal(projectA.status, 201);
    assert.equal(projectB.status, 201);
    assert.equal(companyProject.status, 201);
    assert.equal((await post("/api/projects", projectBody, manager.cookie)).status, 409);
    const projectsPath = `/api/projects?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(projectsPath, accepted.cookie)).data.projects.map((item) => item.id), [projectA.data.project.id]);
    assert.equal((await get(projectsPath.replace(companyA.data.company.id, companyB.data.company.id), accepted.cookie)).status, 403);
    const projectPath = `/api/projects/${projectA.data.project.id}`;
    const tasksPath = `${projectPath}/tasks`;
    assert.equal((await get(`${tasksPath}?tenantId=${tenantId}`, accepted.cookie)).status, 200);
    assert.equal((await get(`/api/projects/${projectB.data.project.id}/tasks?tenantId=${tenantId}`, accepted.cookie)).status, 403);
    assert.equal((await post(tasksPath, { tenantId, title: "Viewer task" }, accepted.cookie)).status, 403);
    const task = await post(tasksPath, { tenantId, title: "Prepare delivery", dueDate: "2026-12-20" }, manager.cookie);
    assert.equal(task.status, 201);
    assert.equal((await patch(projectPath, { tenantId, action: "activate" }, accepted.cookie)).status, 403);
    assert.equal((await patch(projectPath, { tenantId, action: "complete" }, manager.cookie)).status, 409);
    assert.equal((await patch(projectPath, { tenantId, action: "activate" }, manager.cookie)).status, 200);
    assert.equal((await patch(projectPath, { tenantId, action: "complete" }, manager.cookie)).status, 409);
    const taskPath = `${tasksPath}/${task.data.task.id}`;
    assert.equal((await patch(taskPath, { tenantId, action: "start" }, accepted.cookie)).status, 403);
    assert.equal((await patch(taskPath, { tenantId, action: "start" }, manager.cookie)).status, 200);
    assert.equal((await patch(taskPath, { tenantId, action: "start" }, manager.cookie)).status, 409);
    assert.equal((await patch(taskPath, { tenantId, action: "complete" }, manager.cookie)).status, 200);
    assert.equal((await patch(projectPath, { tenantId, action: "complete" }, manager.cookie)).status, 200);
    assert.equal((await post(tasksPath, { tenantId, title: "Too late" }, manager.cookie)).status, 409);
    assert.deepEqual((await get(`${tasksPath}?tenantId=${tenantId}`, accepted.cookie)).data.tasks.map((item) => item.status), ["DONE"]);

    const employeeBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      code: "EMP-A", fullName: "Branch A Employee", jobTitle: "Operations", startDate: "2026-09-01" };
    const employeeListPath = `/api/employees?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.equal((await get(employeeListPath, accepted.cookie)).status, 403);
    assert.equal((await post("/api/employees", employeeBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/employees", { ...employeeBody,
      branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/employees", { ...employeeBody,
      startDate: "2026-02-30" }, manager.cookie)).status, 400);
    const employeeA = await post("/api/employees", employeeBody, manager.cookie);
    const employeeB = await post("/api/employees", { ...employeeBody, branchId: branchB.data.branch.id,
      code: "EMP-B", fullName: "Branch B Employee" }, owner.cookie);
    assert.equal(employeeA.status, 201);
    assert.equal(employeeB.status, 201);
    assert.equal((await post("/api/employees", employeeBody, manager.cookie)).status, 409);
    assert.deepEqual((await get(employeeListPath, manager.cookie)).data.employees.map((item) => item.id), [employeeA.data.employee.id]);
    const employeePath = `/api/employees/${employeeA.data.employee.id}`;
    assert.equal((await patch(employeePath, { tenantId, action: "status", status: "INACTIVE" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/employees/${employeeB.data.employee.id}`,
      { tenantId, action: "status", status: "INACTIVE" }, manager.cookie)).status, 403);
    assert.equal((await patch(employeePath, { tenantId, action: "update", jobTitle: "Supervisor" }, manager.cookie)).status, 200);
    assert.equal((await patch(employeePath, { tenantId, action: "status", status: "INACTIVE" }, manager.cookie)).status, 200);
    assert.deepEqual((await get(employeeListPath, manager.cookie)).data.employees, []);
    assert.deepEqual((await get(`${employeeListPath}&inactive=true`, manager.cookie)).data.employees.map((item) => item.id), [employeeA.data.employee.id]);
    assert.equal((await patch(employeePath, { tenantId, action: "update", jobTitle: "Blocked" }, manager.cookie)).status, 409);
    assert.equal((await patch(employeePath, { tenantId, action: "status", status: "ACTIVE" }, manager.cookie)).status, 200);

    const expenseBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      number: "EXP-A", description: "Branch supplies", category: "Operations",
      amount: "12.375", expenseDate: "2026-09-30" };
    assert.equal((await post("/api/expenses", expenseBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/expenses", { ...expenseBody, branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/expenses", { ...expenseBody, amount: "0" }, manager.cookie)).status, 400);
    assert.equal((await post("/api/expenses", { ...expenseBody, amount: "-1" }, manager.cookie)).status, 400);
    assert.equal((await post("/api/expenses", { ...expenseBody, expenseDate: "2026-02-30" }, manager.cookie)).status, 400);
    const expenseA = await post("/api/expenses", expenseBody, manager.cookie);
    const expenseB = await post("/api/expenses", { ...expenseBody, branchId: branchB.data.branch.id,
      number: "EXP-B", description: "Other branch supplies" }, owner.cookie);
    const sharedExpense = await post("/api/expenses", { ...expenseBody, branchId: null,
      number: "EXP-C", description: "Company supplies" }, owner.cookie);
    assert.equal(expenseA.status, 201);
    assert.equal(expenseB.status, 201);
    assert.equal(sharedExpense.status, 201);
    assert.equal(expenseA.data.expense.currency, "JOD");
    assert.equal((await post("/api/expenses", expenseBody, manager.cookie)).status, 409);
    const expensesPath = `/api/expenses?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(expensesPath, accepted.cookie)).data.expenses.map((item) => item.id), [expenseA.data.expense.id]);
    assert.equal((await get(expensesPath.replace(companyA.data.company.id, companyB.data.company.id), accepted.cookie)).status, 403);
    const expenseStatusPath = `/api/expenses/${expenseA.data.expense.id}/status`;
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/expenses/${expenseB.data.expense.id}/status`,
      { tenantId, action: "post" }, manager.cookie)).status, 403);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "" }, manager.cookie)).status, 400);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, manager.cookie)).status, 200);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, manager.cookie)).status, 409);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "Duplicate entry" }, manager.cookie)).status, 200);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "Again" }, manager.cookie)).status, 409);
    assert.equal((await get(expensesPath, accepted.cookie)).data.expenses[0].voidReason, "Duplicate entry");

    const viewerTeam = await get(`/api/team?tenantId=${tenantId}`, accepted.cookie);
    assert.equal(viewerTeam.status, 403);
    const team = await get(`/api/team?tenantId=${tenantId}`, owner.cookie);
    assert.equal(team.status, 200);
    const viewer = team.data.members.find((member) => member.email === email);
    const ownerMember = team.data.members.find((member) => member.email !== email);
    assert.ok(viewer);
    const selfSuspend = await patch(`/api/team/${ownerMember.id}`, { tenantId, status: "SUSPENDED" }, owner.cookie);
    assert.equal(selfSuspend.status, 403);
    const suspend = await patch(`/api/team/${viewer.id}`, { tenantId, status: "SUSPENDED" }, owner.cookie);
    assert.equal(suspend.status, 200);
    const blocked = await get(`/api/branches?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(blocked.status, 403);
    const reactivate = await patch(`/api/team/${viewer.id}`, { tenantId, status: "ACTIVE" }, owner.cookie);
    assert.equal(reactivate.status, 200);
    const restored = await get(`/api/branches?tenantId=${tenantId}&companyId=${companyA.data.company.id}`, accepted.cookie);
    assert.equal(restored.status, 200);

    const pending = await post("/api/invitations", {
      tenantId, email: `revoked-${suffix()}@example.invalid`, role: "Viewer",
      scope: { type: "COMPANY", companyId: companyB.data.company.id },
    }, owner.cookie);
    assert.equal(pending.status, 201);
    const pendingTeam = await get(`/api/team?tenantId=${tenantId}`, owner.cookie);
    const invite = pendingTeam.data.invitations.find((item) => item.email.startsWith("revoked-"));
    assert.ok(invite);
    const revoked = await fetch(origin + `/api/invitations/${invite.id}?tenantId=${tenantId}`, {
      method: "DELETE", headers: { Cookie: owner.cookie },
    });
    assert.equal(revoked.status, 200);
    const revokedToken = pending.data.path.split("/").at(-1);
    const rejected = await post("/api/invitations/accept", { token: revokedToken, name: "Revoked", password });
    assert.equal(rejected.status, 410);
  } finally {
    server.kill("SIGTERM");
  }
});
