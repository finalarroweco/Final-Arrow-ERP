import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID,createHash } from "node:crypto";
import {PrismaClient} from "@prisma/client";
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
    const salesReportDay = new Date().toISOString().slice(0, 10);
    const salesReportScope = `tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=${salesReportDay}&to=${salesReportDay}`;
    const quoteReportPath = `/api/quotes/report?${salesReportScope}`;
    const orderReportPath = `/api/orders/report?${salesReportScope}`;
    const quoteReport = await get(quoteReportPath, accepted.cookie);
    assert.equal(quoteReport.status, 200);
    assert.equal(quoteReport.data.count, 1);
    assert.equal(quoteReport.data.customerNameBasis, "current");
    assert.deepEqual(quoteReport.data.summary.map(({status,amount})=>({status,amount})), [{status:"ACCEPTED",amount:"6.375"}]);
    assert.equal((await get(`${quoteReportPath}&q=Renamed`, accepted.cookie)).data.count, 1);
    assert.equal((await get(`${quoteReportPath}&q=Branch%20A%20Customer`, accepted.cookie)).data.count, 0);
    const orderReport = await get(orderReportPath, accepted.cookie);
    assert.equal(orderReport.status, 200);
    assert.equal(orderReport.data.count, 1);
    assert.equal(orderReport.data.customerNameBasis, "snapshot");
    assert.equal(orderReport.data.summary[0].status, "COMPLETED");
    assert.equal(orderReport.data.summary[0].amount, "6.375");
    assert.equal((await get(`${orderReportPath}&q=Renamed`, accepted.cookie)).data.count, 0);
    const ownerOrdersReport = await get(orderReportPath, owner.cookie);
    assert.equal(ownerOrdersReport.data.count, 2);
    assert.equal(ownerOrdersReport.data.summary.find(group=>group.status==="CANCELLED").amount, "5.500");
    for (const path of [quoteReportPath, orderReportPath]) {
      assert.equal((await get(`${path}&branchId=${branchB.data.branch.id}`, accepted.cookie)).status, 403);
      assert.equal((await get(`${path}&status=POSTED`, owner.cookie)).status, 400);
      assert.equal((await get(`${path}&from=2020-01-01`, owner.cookie)).status, 400);
      const csv = await fetch(`${origin}${path}&format=csv`, {headers:{Cookie:accepted.cookie}});
      assert.equal(csv.status, 200);
      assert.equal(csv.headers.get("cache-control"), "private, no-store");
      assert.match(await csv.text(), /6\.375/);
    }
    assert.equal((await patch(`/api/customers/${customerA.data.customer.id}`, {tenantId,action:"update",displayName:"=Report customer"}, manager.cookie)).status, 200);
    const formulaQuoteCsv = await fetch(`${origin}${quoteReportPath}&format=csv`, {headers:{Cookie:accepted.cookie}});
    assert.match(await formulaQuoteCsv.text(), /'=Report customer/);
    assert.equal((await patch(`/api/customers/${customerA.data.customer.id}`, {tenantId,action:"update",displayName:"Renamed Customer"}, manager.cookie)).status, 200);
    const salesRangePath = `/api/orders/report?tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=2020-01-01&to=2022-01-01`;
    assert.equal((await get(salesRangePath, owner.cookie)).status, 400);
    assert.equal((await fetch(`${origin}${orderReportPath}`)).status, 401);
    for (const [kind,allowedId,forbiddenId,customer] of [["quotes",quote.data.quote.id,quoteB.data.quote.id,"Renamed Customer"],["orders",order.data.order.id,orderB.data.order.id,"Branch A Customer"]]) {
      const document = await fetch(`${origin}/sales/${kind}/${allowedId}`, {headers:{Cookie:accepted.cookie}});
      assert.equal(document.status, 200);
      const html = await document.text();
      assert.match(html, new RegExp(customer));
      assert.match(html, /Revised service/);
      assert.match(html, /6\.375/);
      const forbiddenDocument = await fetch(`${origin}/sales/${kind}/${forbiddenId}`, {headers:{Cookie:accepted.cookie}});
      assert.equal(forbiddenDocument.status, 404);
    }
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
    const invoiceReportDay = invoice.data.invoice.createdAt.slice(0,10);
    const invoiceReportQuery = new URLSearchParams({tenantId,companyId:companyA.data.company.id,from:invoiceReportDay,to:invoiceReportDay});
    const invoiceRegisterReport = await get(`/api/invoices/report?${invoiceReportQuery}`, accepted.cookie);
    assert.equal(invoiceRegisterReport.status, 200);
    assert.equal(invoiceRegisterReport.data.dateBasis, "createdAtUTC");
    assert.equal(invoiceRegisterReport.data.summary[0].amount, "6.375");
    assert.equal(invoiceRegisterReport.data.summary[0].status, "DRAFT");
    assert.equal((await get(`/api/invoices/report?${invoiceReportQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/invoices/report?${invoiceReportQuery}&status=POSTED`, manager.cookie)).status, 400);
    const invoiceRegisterCsv = await fetch(`${origin}/api/invoices/report?${invoiceReportQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(invoiceRegisterCsv.status, 200);
    assert.match(await invoiceRegisterCsv.text(), /INV-001/);
    const printableInvoice = await fetch(`${origin}/accounting/invoices/${invoice.data.invoice.id}`, {headers:{Cookie:manager.cookie}});
    assert.equal(printableInvoice.status, 200);
    assert.match(await printableInvoice.text(), /INV-001/);
    const isolatedInvoiceActor = await post("/api/auth/register", {name:"Isolated invoice reader",email:`invoice-isolated-${suffix()}@example.invalid`,password,organization:"Isolated invoices",slug:`invoice-isolated-${suffix()}`});
    assert.equal(isolatedInvoiceActor.status, 201);
    assert.equal((await fetch(`${origin}/accounting/invoices/${invoice.data.invoice.id}`, {headers:{Cookie:isolatedInvoiceActor.cookie}})).status, 404);
    const invoiceStatusPath = `/api/invoices/${invoice.data.invoice.id}/status`;
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, accepted.cookie)).status, 403);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void" }, manager.cookie)).status, 400);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 200);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 409);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void", reason: "Entry correction" }, manager.cookie)).status, 200);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "issue" }, manager.cookie)).status, 409);
    assert.equal((await patch(invoiceStatusPath, { tenantId, action: "void", reason: "Again" }, manager.cookie)).status, 409);
    assert.equal((await get(`/api/invoices/report?${invoiceReportQuery}&status=VOID`, manager.cookie)).data.summary[0].amount, "6.375");
    assert.equal((await get(`/api/invoices/report?${invoiceReportQuery}&status=ISSUED`, manager.cookie)).data.count, 0);
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
    const purchaseReportDay = new Date().toISOString().slice(0, 10);
    const purchaseReportPath = `/api/purchase-orders/report?tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=${purchaseReportDay}&to=${purchaseReportDay}`;
    const purchaseReport = await get(purchaseReportPath, accepted.cookie);
    assert.equal(purchaseReport.status, 200);
    assert.equal(purchaseReport.data.count, 1);
    assert.equal(purchaseReport.data.summary[0].amount, "6.375");
    assert.equal(purchaseReport.data.summary[0].status, "DRAFT");
    assert.equal(purchaseReport.data.suppliers[0].supplierName, "Updated Supplier");
    assert.equal((await get(`${purchaseReportPath}&q=missing`, accepted.cookie)).data.count, 0);
    assert.equal((await get(`${purchaseReportPath}&branchId=${branchB.data.branch.id}`, accepted.cookie)).status, 403);
    assert.equal((await get(`${purchaseReportPath}&status=POSTED`, owner.cookie)).status, 400);
    const purchaseCsv = await fetch(`${origin}${purchaseReportPath}&format=csv`, { headers: { Cookie: accepted.cookie } });
    assert.equal(purchaseCsv.status, 200);
    assert.match(await purchaseCsv.text(), /Updated Supplier/);
    const purchasePrint = await fetch(`${origin}/purchasing/orders/${purchaseOrder.data.order.id}`, { headers: { Cookie: accepted.cookie } });
    assert.equal(purchasePrint.status, 200);
    assert.match(await purchasePrint.text(), /PO-001/);
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

    const receiptReadPath = `/api/purchase-orders/receipts/${receipt.data.receipt.id}`;
    const receiptRead = await get(receiptReadPath, accepted.cookie);
    assert.equal(receiptRead.status,200);
    assert.equal(receiptRead.data.receipt.order.number,"PO-001");
    assert.equal(receiptRead.data.receipt.order.supplierName,"Updated Supplier");
    assert.equal(receiptRead.data.receipt.lines[0].quantity,"3");
    assert.equal(receiptRead.data.receipt.lines[0].movement.type,"PURCHASE_RECEIPT");
    assert.equal((await get(receiptReadPath,isolatedInvoiceActor.cookie)).status,404);
    assert.equal((await fetch(`${origin}${receiptReadPath}`)).status,401);
    assert.equal((await get(`${receiptReadPath}?format=pdf`,owner.cookie)).status,400);
    const receiptCsv = await fetch(`${origin}${receiptReadPath}?format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(receiptCsv.status,200);assert.equal(receiptCsv.headers.get("cache-control"),"private, no-store");
    const receiptCsvText=await receiptCsv.text();assert.match(receiptCsvText,/ITEM-A/);assert.match(receiptCsvText,/3\.000/);assert.match(receiptCsvText,/Packaging/);
    const receiptDocument=await fetch(`${origin}/purchasing/receipts/${receipt.data.receipt.id}`,{headers:{Cookie:accepted.cookie}});
    assert.equal(receiptDocument.status,200);assert.match(await receiptDocument.text(),/PO-001/);
    assert.equal((await fetch(`${origin}/purchasing/receipts/${receipt.data.receipt.id}`,{headers:{Cookie:isolatedInvoiceActor.cookie}})).status,404);
    const stockReportDay = (await get(stockPath, accepted.cookie)).data.movements[0].createdAt.slice(0,10);
    const stockReportQuery = new URLSearchParams({tenantId,companyId:companyA.data.company.id,branchId:branchA.data.branch.id,itemId:itemA.data.item.id,from:stockReportDay,to:stockReportDay,timeZone:"UTC"});
    const stockMovementReport = await get(`/api/inventory/stock/report?${stockReportQuery}`, accepted.cookie);
    assert.equal(stockMovementReport.status, 200);
    assert.deepEqual(stockMovementReport.data.summary,{opening:"0.000",incoming:"8.500",outgoing:"2.125",closing:"6.375",count:3});
    assert.equal(stockMovementReport.data.rows.at(-1).balance, "6.375");
    assert.ok(stockMovementReport.data.rows.some(row=>row.type==="PURCHASE_RECEIPT"));
    assert.equal((await get(`/api/inventory/stock/report?${stockReportQuery.toString().replace(branchA.data.branch.id,branchB.data.branch.id)}`, accepted.cookie)).status, 403);
    assert.equal((await get(`/api/inventory/stock/report?${stockReportQuery.toString().replace(itemA.data.item.id,itemB.data.item.id)}`, owner.cookie)).status, 404);
    assert.equal((await get(`/api/inventory/stock/report?${stockReportQuery}&from=2026-09-30`, manager.cookie)).status, 400);
    const stockNextDay = new Date(Date.parse(`${stockReportDay}T00:00:00Z`)+86400000).toISOString().slice(0,10);
    const carriedStockQuery = new URLSearchParams(stockReportQuery);carriedStockQuery.set("from",stockNextDay);carriedStockQuery.set("to",stockNextDay);
    const carriedStock = await get(`/api/inventory/stock/report?${carriedStockQuery}`, manager.cookie);
    assert.deepEqual(carriedStock.data.summary,{opening:"6.375",incoming:"0.000",outgoing:"0.000",closing:"6.375",count:0});
    const stockReportCsv = await fetch(`${origin}/api/inventory/stock/report?${stockReportQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(stockReportCsv.status, 200);
    const stockCsvText = await stockReportCsv.text();
    assert.match(stockCsvText, /OPENING/);assert.match(stockCsvText, /CLOSING/);assert.match(stockCsvText, /6.375/);
    assert.equal((await patch(itemPath,{tenantId,action:"archive",archived:true},manager.cookie)).status, 200);
    assert.ok((await get(`/api/inventory/stock/report?${stockReportQuery}`,manager.cookie)).data.item.archivedAt);
    assert.equal((await patch(itemPath,{tenantId,action:"archive",archived:false},manager.cookie)).status, 200);
    const stockDateDb = new PrismaClient();
    try {
      const sharedStockMovement = stock.data.movements.find(movement=>movement.delta==="1.25");
      await stockDateDb.stockMovement.update({where:{id:sharedStockMovement.id},data:{createdAt:new Date("2026-09-30T21:30:00Z"),reason:"=Boundary test"}});
      const boundaryStockQuery = new URLSearchParams({...Object.fromEntries(stockReportQuery),itemId:sharedItem.data.item.id,from:"2026-10-01",to:"2026-10-01",timeZone:"Asia/Muscat"});
      const muscatStock = await get(`/api/inventory/stock/report?${boundaryStockQuery}`,manager.cookie);
      assert.equal(muscatStock.data.summary.opening, "0.000");assert.equal(muscatStock.data.summary.incoming, "1.250");
      assert.equal(muscatStock.data.rows[0].timestamp,"2026-10-01 01:30:00");
      boundaryStockQuery.set("timeZone","UTC");
      const utcStock = await get(`/api/inventory/stock/report?${boundaryStockQuery}`,manager.cookie);
      assert.equal(utcStock.data.summary.opening,"1.250");assert.equal(utcStock.data.summary.count,0);
      boundaryStockQuery.set("timeZone","Asia/Muscat");
      const boundaryStockCsv = await fetch(`${origin}/api/inventory/stock/report?${boundaryStockQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
      assert.ok((await boundaryStockCsv.text()).includes("'=Boundary test"));
    } finally {await stockDateDb.$disconnect();}
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

    const assignedProject = await post("/api/projects", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, code: "PRJ-TEAM", name: "Team project" }, manager.cookie);
    assert.equal(assignedProject.status, 201);
    const deadlineProject = await post("/api/projects",{tenantId,companyId:companyA.data.company.id,branchId:branchA.data.branch.id,code:"PRJ-DEADLINE",name:"Deadline tracking"},manager.cookie);
    assert.equal(deadlineProject.status,201);
    assert.equal((await patch(`/api/projects/${deadlineProject.data.project.id}`,{tenantId,action:"activate"},manager.cookie)).status,200);
    const deadlinePath = `/api/projects/${deadlineProject.data.project.id}/tasks`;
    const deadlineBase = await get(`${deadlinePath}?tenantId=${tenantId}`,accepted.cookie);
    const deadlineToday = deadlineBase.data.summary.today;
    const deadlineDay = offset=>new Date(Date.parse(`${deadlineToday}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10);
    const lateDeadline = await post(deadlinePath,{tenantId,title:"Deadline late",dueDate:deadlineDay(-1)},manager.cookie);
    await post(deadlinePath,{tenantId,title:"Deadline today",dueDate:deadlineToday},manager.cookie);
    await post(deadlinePath,{tenantId,title:"Deadline third day",dueDate:deadlineDay(3)},manager.cookie);
    await post(deadlinePath,{tenantId,title:"Deadline fourth day",dueDate:deadlineDay(4)},manager.cookie);
    await post(deadlinePath,{tenantId,title:"Deadline undated"},manager.cookie);
    const allDeadlines = await get(`${deadlinePath}?tenantId=${tenantId}`,accepted.cookie);
    assert.deepEqual(allDeadlines.data.summary,{today:deadlineToday,nearEnd:deadlineDay(3),active:5,overdue:1,dueSoon:2,undated:1});
    assert.deepEqual((await get(`${deadlinePath}?tenantId=${tenantId}&due=OVERDUE`,accepted.cookie)).data.tasks.map(task=>task.title),["Deadline late"]);
    assert.equal((await get(`${deadlinePath}?tenantId=${tenantId}&due=DUE_SOON`,accepted.cookie)).data.tasks.length,2);
    assert.equal((await get(`${deadlinePath}?tenantId=${tenantId}&due=UNDATED`,accepted.cookie)).data.tasks[0].title,"Deadline undated");
    const searchedDeadlines = await get(`${deadlinePath}?tenantId=${tenantId}&q=TODAY&status=TODO`,accepted.cookie);
    assert.equal(searchedDeadlines.data.tasks.length,1);
    assert.deepEqual(searchedDeadlines.data.summary,allDeadlines.data.summary);
    const emptyDeadlinePage = await get(`${deadlinePath}?tenantId=${tenantId}&page=1`,accepted.cookie);
    assert.equal(emptyDeadlinePage.data.tasks.length,0);
    assert.deepEqual(emptyDeadlinePage.data.summary,allDeadlines.data.summary);
    assert.equal((await get(`${deadlinePath}?tenantId=${tenantId}&page=0&page=1`,accepted.cookie)).status,400);
    assert.equal((await get(`${deadlinePath}?tenantId=${tenantId}&due=INVALID`,accepted.cookie)).status,400);
    assert.equal((await get(`${deadlinePath}?tenantId=${randomUUID()}`,accepted.cookie)).status,404);
    assert.equal((await patch(`${deadlinePath}/${lateDeadline.data.task.id}`,{tenantId,action:"complete"},manager.cookie)).status,200);
    const finishedDeadline = await get(`${deadlinePath}?tenantId=${tenantId}&status=DONE`,accepted.cookie);
    assert.equal(finishedDeadline.data.tasks[0].dueBucket,null);
    assert.equal(finishedDeadline.data.summary.overdue,0);
    assert.equal(finishedDeadline.data.summary.active,4);
    assert.equal((await get(`${deadlinePath}?tenantId=${tenantId}&status=DONE&due=OVERDUE`,accepted.cookie)).data.tasks.length,0);
    const assignedTasksPath = `/api/projects/${assignedProject.data.project.id}/tasks`;
    assert.equal((await post(assignedTasksPath, { tenantId, title: "Wrong company",
      assigneeEmployeeId: randomUUID() }, manager.cookie)).status, 404);
    assert.equal((await post(assignedTasksPath, { tenantId, title: "Wrong branch",
      assigneeEmployeeId: employeeB.data.employee.id }, owner.cookie)).status, 409);
    const assignedTask = await post(assignedTasksPath, { tenantId, title: "Assigned task",
      assigneeEmployeeId: employeeA.data.employee.id }, manager.cookie);
    assert.equal(assignedTask.status, 201);
    assert.equal(assignedTask.data.task.assigneeEmployeeId, employeeA.data.employee.id);
    const viewerAssigned = await get(`${assignedTasksPath}?tenantId=${tenantId}`, accepted.cookie);
    assert.equal(viewerAssigned.data.tasks[0].assigneeName, null);
    const managerAssigned = await get(`${assignedTasksPath}?tenantId=${tenantId}`, manager.cookie);
    assert.equal(managerAssigned.data.tasks[0].assigneeName, "Branch A Employee");
    const assignedTaskPath = `${assignedTasksPath}/${assignedTask.data.task.id}`;
    assert.equal((await patch(assignedTaskPath, { tenantId, action: "assign",
      employeeId: null }, accepted.cookie)).status, 403);
    assert.equal((await patch(assignedTaskPath, { tenantId, action: "assign",
      employeeId: employeeB.data.employee.id }, owner.cookie)).status, 409);
    assert.equal((await patch(assignedTaskPath, { tenantId, action: "assign",
      employeeId: null }, manager.cookie)).status, 200);
    assert.equal((await get(`${assignedTasksPath}?tenantId=${tenantId}`, manager.cookie))
      .data.tasks[0].assigneeEmployeeId, null);

    const leaveBody = { tenantId, companyId: companyA.data.company.id, employeeId: employeeA.data.employee.id,
      type: "ANNUAL", startDate: "2026-11-01", endDate: "2026-11-05", note: "Family visit" };
    assert.equal((await post("/api/leave-requests", leaveBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/leave-requests", { ...leaveBody,
      employeeId: employeeB.data.employee.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/leave-requests", { ...leaveBody,
      companyId: companyB.data.company.id }, owner.cookie)).status, 404);
    assert.equal((await post("/api/leave-requests", { ...leaveBody,
      endDate: "2026-10-31" }, manager.cookie)).status, 400);
    const leaveA = await post("/api/leave-requests", leaveBody, manager.cookie);
    const leaveB = await post("/api/leave-requests", { ...leaveBody,
      employeeId: employeeB.data.employee.id, note: "Other branch" }, owner.cookie);
    assert.equal(leaveA.status, 201);
    assert.equal(leaveB.status, 201);
    const leavePath = `/api/leave-requests?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.equal((await get(leavePath, accepted.cookie)).status, 403);
    assert.deepEqual((await get(leavePath, manager.cookie)).data.requests.map((item) => item.id), [leaveA.data.request.id]);
    assert.equal((await get(leavePath.replace(companyA.data.company.id, companyB.data.company.id), manager.cookie)).status, 403);
    const leaveDecision = `/api/leave-requests/${leaveA.data.request.id}`;
    assert.equal((await patch(leaveDecision, { tenantId, action: "approve" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/leave-requests/${leaveB.data.request.id}`,
      { tenantId, action: "approve" }, manager.cookie)).status, 403);
    assert.equal((await patch(leaveDecision, { tenantId, action: "reject", note: "" }, manager.cookie)).status, 400);
    assert.equal((await patch(leaveDecision, { tenantId, action: "approve" }, manager.cookie)).status, 200);
    assert.equal((await patch(leaveDecision, { tenantId, action: "approve" }, manager.cookie)).status, 409);
    assert.equal((await patch(leaveDecision, { tenantId, action: "cancel", note: "Employee requested" }, manager.cookie)).status, 200);
    assert.equal((await patch(leaveDecision, { tenantId, action: "cancel", note: "Again" }, manager.cookie)).status, 409);
    assert.equal((await get(leavePath, manager.cookie)).data.requests[0].decisionNote, "Employee requested");
    const rejectedLeave = await post("/api/leave-requests", { ...leaveBody,
      startDate: "2026-12-01", endDate: "2026-12-02" }, manager.cookie);
    assert.equal(rejectedLeave.status, 201);
    assert.equal((await patch(`/api/leave-requests/${rejectedLeave.data.request.id}`,
      { tenantId, action: "reject", note: "Staffing constraint" }, manager.cookie)).status, 200);

    const expenseBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      number: "EXP-A", description: "=Branch supplies", category: "Operations",
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
    const expenseReportQuery = new URLSearchParams({tenantId,companyId:companyA.data.company.id,from:"2026-09-30",to:"2026-09-30"});
    const scopedExpenseReport = await get(`/api/expenses/report?${expenseReportQuery}`, accepted.cookie);
    assert.equal(scopedExpenseReport.status, 200);
    assert.equal(scopedExpenseReport.data.count, 1);
    assert.equal(scopedExpenseReport.data.summary[0].amount, "12.375");
    assert.equal(scopedExpenseReport.data.categories[0].category, "Operations");
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}`, owner.cookie)).data.summary[0].amount, "37.125");
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&branchId=${branchB.data.branch.id}`, accepted.cookie)).status, 403);
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&q=missing`, manager.cookie)).data.count, 0);
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&from=2026-09-29`, manager.cookie)).status, 400);
    assert.equal((await get(`/api/expenses/report?tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=2026-10-01&to=2026-09-30`, manager.cookie)).status, 400);
    const expenseRegisterCsv = await fetch(`${origin}/api/expenses/report?${expenseReportQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(expenseRegisterCsv.status, 200);
    const expenseRegisterText = await expenseRegisterCsv.text();
    assert.match(expenseRegisterText, /EXP-A/);
    assert.ok(expenseRegisterText.includes("'=Branch supplies"));
    assert.doesNotMatch(expenseRegisterText, /EXP-B|EXP-C/);
    const expenseStatusPath = `/api/expenses/${expenseA.data.expense.id}/status`;
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/expenses/${expenseB.data.expense.id}/status`,
      { tenantId, action: "post" }, manager.cookie)).status, 403);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "" }, manager.cookie)).status, 400);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, manager.cookie)).status, 200);
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&status=POSTED`, manager.cookie)).data.summary[0].amount, "12.375");
    const scopedDashboard = await get(dashboardPath, accepted.cookie);
    assert.equal(scopedDashboard.status, 200);
    assert.equal(scopedDashboard.data.projects.COMPLETED, 1);
    assert.equal(scopedDashboard.data.projects.PLANNED, 1);
    assert.equal(scopedDashboard.data.employees, null);
    assert.deepEqual(scopedDashboard.data.expenses, { currency: "JOD", postedCount: 1, postedAmount: "12.375" });
    const managerDashboard = await get(dashboardPath, manager.cookie);
    assert.equal(managerDashboard.data.employees, 1);
    assert.equal(managerDashboard.data.projects.COMPLETED, 1);
    assert.equal(managerDashboard.data.expenses.postedCount, 1);
    const ownerAllDashboard = await get(dashboardPath, owner.cookie);
    assert.equal(ownerAllDashboard.data.employees, 2);
    assert.equal(ownerAllDashboard.data.projects.PLANNED, 3);
    assert.equal(ownerAllDashboard.data.expenses.postedCount, 1);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "post" }, manager.cookie)).status, 409);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "Duplicate entry" }, manager.cookie)).status, 200);
    assert.equal((await patch(expenseStatusPath, { tenantId, action: "void", reason: "Again" }, manager.cookie)).status, 409);
    assert.equal((await get(expensesPath, accepted.cookie)).data.expenses[0].voidReason, "Duplicate entry");
    assert.deepEqual((await get(dashboardPath, accepted.cookie)).data.expenses,
      { currency: "JOD", postedCount: 0, postedAmount: "0" });

    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&status=POSTED`, manager.cookie)).data.count, 0);
    assert.equal((await get(`/api/expenses/report?${expenseReportQuery}&status=VOID`, manager.cookie)).data.summary[0].amount, "12.375");
    const inboxLeave = await post("/api/leave-requests", { ...leaveBody,
      startDate: "2027-01-04", endDate: "2027-01-05" }, manager.cookie);
    const inboxExpense = await post("/api/expenses", { ...expenseBody,
      number: "EXP-INBOX", description: "Approval inbox expense" }, manager.cookie);
    const inboxPurchase = await post("/api/purchase-orders", { ...purchaseOrderBody,
      number: "PO-INBOX" }, manager.cookie);
    assert.equal(inboxLeave.status, 201);
    assert.equal(inboxExpense.status, 201);
    assert.equal(inboxPurchase.status, 201);
    const inboxPath = `/api/approvals?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.equal((await get(inboxPath, accepted.cookie)).status, 403);
    const managerInbox = await get(inboxPath, manager.cookie);
    assert.equal(managerInbox.status, 200);
    assert.deepEqual(managerInbox.data.counts, { leave: 1, expense: 1, purchase: 1, payroll: 0 });
    assert.deepEqual(new Set(managerInbox.data.items.map((item) => item.id)),
      new Set([inboxLeave.data.request.id, inboxExpense.data.expense.id, inboxPurchase.data.order.id]));
    assert.equal((await get(inboxPath.replace(companyA.data.company.id, companyB.data.company.id), manager.cookie)).status, 403);
    const ownerInbox = await get(inboxPath, owner.cookie);
    assert.equal(ownerInbox.data.counts.leave, 2);
    assert.equal(ownerInbox.data.counts.expense, 3);
    assert.equal(ownerInbox.data.counts.purchase, 1);
    assert.equal((await patch(`/api/leave-requests/${inboxLeave.data.request.id}`,
      { tenantId, action: "approve" }, manager.cookie)).status, 200);
    assert.equal((await patch(`/api/expenses/${inboxExpense.data.expense.id}/status`,
      { tenantId, action: "post" }, manager.cookie)).status, 200);
    assert.equal((await patch(`/api/purchase-orders/${inboxPurchase.data.order.id}/status`,
      { tenantId, action: "issue" }, manager.cookie)).status, 200);
    assert.deepEqual((await get(inboxPath, manager.cookie)).data.counts,
      { leave: 0, expense: 0, purchase: 0, payroll: 0 });

    const ticketBody = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      customerId: customerA.data.customer.id, assigneeEmployeeId: employeeA.data.employee.id,
      number: "TKT-A", subject: "Delivery question", description: "Check delivery status", priority: "HIGH" };
    assert.equal((await post("/api/tickets", ticketBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/tickets", { ...ticketBody, branchId: branchB.data.branch.id },
      manager.cookie)).status, 403);
    assert.equal((await post("/api/tickets", { ...ticketBody, customerId: customerB.data.customer.id,
      number: "TKT-WRONG" }, owner.cookie)).status, 409);
    assert.equal((await post("/api/tickets", { ...ticketBody, assigneeEmployeeId: employeeB.data.employee.id,
      number: "TKT-WRONG" }, owner.cookie)).status, 409);
    assert.equal((await post("/api/tickets", { ...ticketBody, companyId: companyB.data.company.id,
      number: "TKT-CROSS" }, owner.cookie)).status, 404);
    const ticketA = await post("/api/tickets", ticketBody, manager.cookie);
    const ticketB = await post("/api/tickets", { ...ticketBody, branchId: branchB.data.branch.id,
      customerId: customerB.data.customer.id, assigneeEmployeeId: employeeB.data.employee.id,
      number: "TKT-B", subject: "Other branch request" }, owner.cookie);
    const sharedTicket = await post("/api/tickets", { ...ticketBody, branchId: null,
      customerId: sharedCustomer.data.customer.id, assigneeEmployeeId: null,
      number: "TKT-C", subject: "Company request" }, owner.cookie);
    assert.equal(ticketA.status, 201);
    assert.equal(ticketB.status, 201);
    assert.equal(sharedTicket.status, 201);
    assert.equal((await post("/api/tickets", ticketBody, manager.cookie)).status, 409);
    const ticketsPath = `/api/tickets?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    const viewerTickets = await get(ticketsPath, accepted.cookie);
    assert.deepEqual(viewerTickets.data.tickets.map((item) => item.id), [ticketA.data.ticket.id]);
    assert.equal(viewerTickets.data.tickets[0].customerName, "Renamed Customer");
    assert.equal(viewerTickets.data.tickets[0].assigneeName, null);
    assert.equal((await get(ticketsPath.replace(companyA.data.company.id, companyB.data.company.id),
      accepted.cookie)).status, 403);
    assert.equal((await get(ticketsPath, manager.cookie)).data.tickets[0].assigneeName, "Branch A Employee");
    const ticketPath = `/api/tickets/${ticketA.data.ticket.id}`;
    assert.equal((await patch(ticketPath, { tenantId, action: "start" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/tickets/${ticketB.data.ticket.id}`,
      { tenantId, action: "start" }, manager.cookie)).status, 403);
    assert.equal((await patch(ticketPath, { tenantId, action: "close" }, manager.cookie)).status, 409);
    assert.equal((await patch(ticketPath, { tenantId, action: "update", priority: "URGENT" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "assign",
      employeeId: employeeB.data.employee.id }, owner.cookie)).status, 409);
    assert.equal((await patch(ticketPath, { tenantId, action: "assign", employeeId: null }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "start" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "start" }, manager.cookie)).status, 409);
    assert.equal((await patch(ticketPath, { tenantId, action: "resolve", note: "" }, manager.cookie)).status, 400);
    assert.equal((await patch(ticketPath, { tenantId, action: "resolve", note: "Delivery confirmed" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "reopen" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "resolve", note: "Confirmed again" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "close" }, manager.cookie)).status, 200);
    assert.equal((await patch(ticketPath, { tenantId, action: "reopen" }, manager.cookie)).status, 409);
    assert.equal((await get(dashboardPath, accepted.cookie)).data.tickets.CLOSED, 1);
    assert.equal((await get(dashboardPath, accepted.cookie)).data.tickets.OPEN, 0);
    assert.equal((await get(dashboardPath, owner.cookie)).data.tickets.OPEN, 2);

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

    const attendanceEmployeeA = await post("/api/employees", { tenantId,
      companyId: companyA.data.company.id, branchId: branchA.data.branch.id,
      code: "ATT-A", fullName: "Branch A Employee" }, owner.cookie);
    const attendanceEmployeeB = await post("/api/employees", { tenantId,
      companyId: companyA.data.company.id, branchId: branchB.data.branch.id,
      code: "ATT-B", fullName: "Branch B Employee" }, owner.cookie);
    assert.equal(attendanceEmployeeA.status, 201);
    assert.equal(attendanceEmployeeB.status, 201);
    const attendanceA = await post("/api/attendance", { tenantId, companyId: companyA.data.company.id,
      employeeId: attendanceEmployeeA.data.employee.id, workDate: "2026-09-30", startMinute: 480,
      endMinute: 1020 }, owner.cookie);
    const attendanceB = await post("/api/attendance", { tenantId, companyId: companyA.data.company.id,
      employeeId: attendanceEmployeeB.data.employee.id, workDate: "2026-09-30", startMinute: 540 }, owner.cookie);
    assert.equal(attendanceA.status, 201);
    assert.equal(attendanceB.status, 201);
    const directoryQuery = `tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.deepEqual((await get(`/api/employees?${directoryQuery}&q=att-a`, manager.cookie)).data.employees.map((employee) => employee.id), [attendanceEmployeeA.data.employee.id]);
    assert.equal((await get(`/api/employees?${directoryQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.deepEqual((await get(`/api/employees?${directoryQuery}&q=NO-SUCH-EMPLOYEE`, owner.cookie)).data.employees, []);
    const attendanceListQuery = `tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    const completedAttendance = await get(`/api/attendance?${attendanceListQuery}&status=completed&q=ATT-A`, manager.cookie);
    assert.equal(completedAttendance.status, 200);
    assert.deepEqual(completedAttendance.data.records.map((record) => record.id), [attendanceA.data.record.id]);
    assert.deepEqual((await get(`/api/attendance?${attendanceListQuery}&status=open`, manager.cookie)).data.records, []);
    assert.equal((await get(`/api/attendance?${attendanceListQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.deepEqual((await get(`/api/attendance?${attendanceListQuery}&from=2026-10-01`, owner.cookie)).data.records, []);
    assert.equal((await get(`/api/attendance?${attendanceListQuery}&from=2026-10-01&to=2026-09-01`, owner.cookie)).status, 400);
    const attendanceQuery = `tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=2026-09-01&to=2026-09-30`;
    assert.equal((await get(`/api/attendance/report?${attendanceQuery}`, accepted.cookie)).status, 403);
    const managerReport = await get(`/api/attendance/report?${attendanceQuery}`, manager.cookie);
    assert.equal(managerReport.status, 200);
    assert.deepEqual(managerReport.data.rows.map((row) => row.employeeCode), ["ATT-A"]);
    assert.equal(managerReport.data.summary.completedMinutes, 540);
    assert.equal((await get(`/api/attendance/report?${attendanceQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/attendance/report?tenantId=${tenantId}&companyId=${companyA.data.company.id}&from=2026-09-01&to=2026-10-02`, owner.cookie)).status, 400);
    assert.equal((await get(`/api/attendance/report?${attendanceQuery}&to=2026-10-02`, owner.cookie)).status, 400);
    const csvReport = await fetch(`${origin}/api/attendance/report?${attendanceQuery}&format=csv`,
      { headers: { Cookie: manager.cookie } });
    assert.equal(csvReport.status, 200);
    assert.match(csvReport.headers.get("content-type"), /text\/csv/);
    assert.match(await csvReport.text(), /ATT-A/);

    const timedProject = await post("/api/projects", { tenantId, companyId: companyA.data.company.id,
      branchId: branchA.data.branch.id, code: "PRJ-TIME", name: "Time tracking project" }, owner.cookie);
    assert.equal(timedProject.status, 201);
    const timePath = `/api/projects/${timedProject.data.project.id}/time`;
    const timeBody = { tenantId, employeeId: attendanceEmployeeA.data.employee.id,
      workDate: "2026-10-01", minutes: 90, description: "=Prepare project deliverables" };
    assert.equal((await post(timePath, timeBody, manager.cookie)).status, 409);
    assert.equal((await patch(`/api/projects/${timedProject.data.project.id}`, { tenantId, action: "activate" }, manager.cookie)).status, 200);
    assert.equal((await post(timePath, timeBody, accepted.cookie)).status, 403);
    assert.equal((await post(timePath, { ...timeBody, employeeId: attendanceEmployeeB.data.employee.id }, owner.cookie)).status, 409);
    assert.equal((await post(timePath, { ...timeBody, minutes: 0 }, manager.cookie)).status, 400);
    const timeEntry = await post(timePath, timeBody, manager.cookie);
    assert.equal(timeEntry.status, 201);
    const times = await get(`${timePath}?tenantId=${tenantId}`, manager.cookie);
    assert.equal(times.status, 200);
    assert.equal(times.data.totalMinutes, 90);
    assert.equal(times.data.entries[0].employeeName, "Branch A Employee");
    const projectReportQuery = new URLSearchParams({tenantId,from:"2026-10-01",to:"2026-10-01"});
    const projectTimeReport = await get(`${timePath}/report?${projectReportQuery}`, manager.cookie);
    assert.equal(projectTimeReport.status, 200);
    assert.equal(projectTimeReport.data.summary.totalMinutes, 90);
    assert.equal(projectTimeReport.data.summary.employees[0].employeeName, "Branch A Employee");
    assert.equal((await get(`${timePath}/report?${projectReportQuery}&from=2026-09-01`, manager.cookie)).status, 400);
    assert.equal((await get(`${timePath}/report?tenantId=${tenantId}&from=2026-10-02&to=2026-10-01`, manager.cookie)).status, 400);
    const projectTimeCsv = await fetch(`${origin}${timePath}/report?${projectReportQuery}&format=csv`, {headers:{Cookie:manager.cookie}});
    assert.equal(projectTimeCsv.status, 200);
    assert.match(await projectTimeCsv.text(), /'\=Prepare project deliverables/);
    assert.equal((await get(`${timePath}/report?tenantId=${tenantId}&from=2026-10-02&to=2026-10-03`, manager.cookie)).data.summary.totalMinutes, 0);
    assert.equal((await get(`${timePath}/report?tenantId=${randomUUID()}&from=2026-10-01&to=2026-10-01`, owner.cookie)).status, 404);
    const voidTimeBody = { tenantId, entryId: timeEntry.data.entry.id, reason: "Incorrect duration" };
    assert.equal((await patch(timePath, voidTimeBody, accepted.cookie)).status, 403);
    assert.equal((await patch(timePath, voidTimeBody, manager.cookie)).status, 200);
    assert.equal((await patch(timePath, voidTimeBody, manager.cookie)).status, 409);
    assert.equal((await get(`/api/audit?tenantId=${tenantId}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/audit?tenantId=${tenantId}`, accepted.cookie)).status, 403);
    const audit = await get(`/api/audit?tenantId=${tenantId}&action=project-time.voided&entity=ProjectTimeEntry`, owner.cookie);
    assert.equal(audit.status, 200);
    assert.equal(audit.data.entries.length, 1);
    assert.equal(audit.data.entries[0].entityId, timeEntry.data.entry.id);
    assert.equal(audit.data.entries[0].actorName, "Manager");
    assert.equal("metadata" in audit.data.entries[0], false);
    assert.equal((await get(`/api/audit?tenantId=${randomUUID()}`, owner.cookie)).status, 403);
    const correctedTimes = await get(`${timePath}?tenantId=${tenantId}`, manager.cookie);
    assert.equal(correctedTimes.data.totalMinutes, 0);
    assert.equal((await get(`${timePath}/report?${projectReportQuery}`, manager.cookie)).data.summary.totalMinutes, 0);
    assert.ok(correctedTimes.data.entries[0].voidedAt);
    const otherTimedProject = await post("/api/projects", { tenantId, companyId: companyA.data.company.id,
      branchId: branchB.data.branch.id, code: "PRJ-TIME-B", name: "Other branch time" }, owner.cookie);
    assert.equal(otherTimedProject.status, 201);
    assert.equal((await get(`/api/projects/${otherTimedProject.data.project.id}/time/report?${projectReportQuery}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/projects/${otherTimedProject.data.project.id}/time?tenantId=${tenantId}`, manager.cookie)).status, 403);


    const payrollBody = { tenantId, companyId: companyA.data.company.id,
      employeeId: attendanceEmployeeA.data.employee.id, period: "2026-10",
      baseSalary: "350.125", allowances: "20.050", deductions: "10.001" };
    assert.equal((await post("/api/payroll", payrollBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/payroll", { ...payrollBody, employeeId: attendanceEmployeeB.data.employee.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/payroll", { ...payrollBody, deductions: "999.000" }, owner.cookie)).status, 400);
    const payroll = await post("/api/payroll", payrollBody, manager.cookie);
    assert.equal(payroll.status, 201);
    assert.equal(payroll.data.entry.netPay, "360.174");
    assert.equal((await post("/api/payroll", payrollBody, owner.cookie)).status, 409);
    const payrollInboxPath = `/api/approvals?tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    const payrollInbox = await get(payrollInboxPath, owner.cookie);
    assert.equal(payrollInbox.data.counts.payroll, 1);
    assert.equal(payrollInbox.data.items.some((item) => item.type === "PAYROLL" && item.id === payroll.data.entry.id), true);
    const managerPayrollInbox = await get(payrollInboxPath, manager.cookie);
    assert.equal(managerPayrollInbox.data.counts.payroll, 0);
    assert.equal(managerPayrollInbox.data.items.some((item) => item.type === "PAYROLL"), false);
    const payrollPath = `/api/payroll/${payroll.data.entry.id}`;
    assert.equal((await patch(payrollPath, { tenantId, action: "approve" }, manager.cookie)).status, 403);
    assert.equal((await patch(payrollPath, { tenantId, action: "pay", reference: "BANK-001" }, owner.cookie)).status, 409);
    assert.equal((await patch(payrollPath, { tenantId, action: "approve" }, owner.cookie)).status, 200);
    assert.equal((await get(payrollInboxPath, owner.cookie)).data.counts.payroll, 0);
    assert.equal((await patch(payrollPath, { tenantId, action: "pay", reference: "BANK-001" }, manager.cookie)).status, 403);
    assert.equal((await patch(payrollPath, { tenantId, action: "pay", reference: "BANK-001" }, owner.cookie)).status, 200);
    assert.equal((await patch(payrollPath, { tenantId, action: "pay", reference: "BANK-002" }, owner.cookie)).status, 409);
    assert.equal((await patch(payrollPath, { tenantId, action: "void", reason: "Cannot void paid" }, owner.cookie)).status, 409);
    assert.equal((await fetch(`${origin}/hr/payroll/${payroll.data.entry.id}`, { headers: { Cookie: accepted.cookie } })).status, 404);
    const statement = await fetch(`${origin}/hr/payroll/${payroll.data.entry.id}`, { headers: { Cookie: owner.cookie } });
    assert.equal(statement.status, 200);
    assert.match(await statement.text(), /360.174/);
    const otherPayroll = await post("/api/payroll", { ...payrollBody, employeeId: attendanceEmployeeB.data.employee.id }, owner.cookie);
    assert.equal(otherPayroll.status, 201);
    assert.equal((await fetch(`${origin}/hr/payroll/${otherPayroll.data.entry.id}`, { headers: { Cookie: manager.cookie } })).status, 404);
    const payrollQuery = `tenantId=${tenantId}&companyId=${companyA.data.company.id}&period=2026-10`;
    assert.equal((await get(`/api/payroll?${payrollQuery}&status=PAID&q=att-a`, owner.cookie)).data.entries.length, 1);
    assert.equal((await get(`/api/payroll?${payrollQuery}&status=DRAFT&q=att-a`, owner.cookie)).data.entries.length, 0);
    assert.equal((await get(`/api/payroll?${payrollQuery}&q=no-match`, owner.cookie)).data.entries.length, 0);
    assert.equal((await get(`/api/payroll?${payrollQuery}&status=INVALID`, owner.cookie)).status, 400);
    assert.equal((await get(`/api/payroll?${payrollQuery}&status=PAID&status=DRAFT`, owner.cookie)).status, 400);
    assert.equal((await get(`/api/payroll?${payrollQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    const payrollReport = `/api/payroll/report?${payrollQuery}&q=att-a`;
    const monthlyPayroll = await get(payrollReport, manager.cookie);
    assert.equal(monthlyPayroll.status, 200);
    assert.equal(monthlyPayroll.data.count, 1);
    assert.equal(monthlyPayroll.data.summary[0].netPay, "360.174");
    assert.equal(monthlyPayroll.data.summary[0].status, "PAID");
    assert.equal((await get(payrollReport, accepted.cookie)).status, 403);
    assert.equal((await get(`${payrollReport}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.equal((await get(`${payrollReport}&period=2026-11`, owner.cookie)).status, 400);
    const payrollCsv = await fetch(`${origin}${payrollReport}&format=csv`, { headers: { Cookie: manager.cookie } });
    assert.equal(payrollCsv.status, 200);
    assert.match(payrollCsv.headers.get("content-type"), /text\/csv/);
    assert.match(await payrollCsv.text(), /360\.174/);
    assert.equal((await get(`/api/payroll?${payrollQuery}`, accepted.cookie)).status, 403);
    assert.deepEqual((await get(`/api/payroll?${payrollQuery}`, manager.cookie)).data.entries.map((entry) => entry.id), [payroll.data.entry.id]);
    assert.equal((await patch(`/api/payroll/${otherPayroll.data.entry.id}`, { tenantId, action: "void", reason: "Correct input" }, owner.cookie)).status, 200);
    assert.equal((await post("/api/payroll", { ...payrollBody, employeeId: attendanceEmployeeB.data.employee.id }, owner.cookie)).status, 201);
    const allPayrollTotals = await get(`/api/payroll/report?${payrollQuery}`, owner.cookie);
    assert.equal(allPayrollTotals.data.count, 3);
    assert.deepEqual(allPayrollTotals.data.summary.map((group) => group.status).sort(), ["DRAFT", "PAID", "VOID"]);
    assert.equal(allPayrollTotals.data.summary.every((group) => group.netPay === "360.174"), true);
    assert.equal((await get(`/api/payroll/report?${payrollQuery}&status=PAID`, owner.cookie)).data.count, 1);


    const accountScope = { tenantId, companyId: companyA.data.company.id };
    assert.equal((await post("/api/ledger/accounts", { ...accountScope, code: "1000", name: "Cash", type: "ASSET" }, manager.cookie)).status, 403);
    const cash = await post("/api/ledger/accounts", { ...accountScope, code: "1000", name: "Cash", type: "ASSET" }, owner.cookie);
    const revenue = await post("/api/ledger/accounts", { ...accountScope, code: "4000", name: "Revenue", type: "REVENUE" }, owner.cookie);
    assert.equal(cash.status, 201); assert.equal(revenue.status, 201);
    assert.equal((await post("/api/ledger/accounts", { ...accountScope, code: "1000", name: "Duplicate", type: "ASSET" }, owner.cookie)).status, 409);
    const foreignAccount = await post("/api/ledger/accounts", { tenantId, companyId: companyB.data.company.id, code: "1000", name: "Other cash", type: "ASSET" }, owner.cookie);
    const journalBody = { ...accountScope, branchId: branchA.data.branch.id, number: "JE-001", entryDate: "2026-10-01", description: "Manual cash revenue",
      lines: [{ accountId: cash.data.account.id, debit: "12.345", credit: "0" }, { accountId: revenue.data.account.id, debit: "0", credit: "12.345" }] };
    assert.equal((await post("/api/ledger/journals", journalBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/ledger/journals", { ...journalBody, branchId: branchB.data.branch.id }, manager.cookie)).status, 403);
    assert.equal((await post("/api/ledger/journals", { ...journalBody, branchId: null }, manager.cookie)).status, 403);
    assert.equal((await post("/api/ledger/journals", { ...journalBody, lines: [journalBody.lines[0], { ...journalBody.lines[1], credit: "12.344" }] }, owner.cookie)).status, 400);
    assert.equal((await post("/api/ledger/journals", { ...journalBody, lines: [{ ...journalBody.lines[0], accountId: foreignAccount.data.account.id }, journalBody.lines[1]] }, owner.cookie)).status, 400);
    assert.equal((await post("/api/ledger/journals", { ...journalBody, lines: [{ ...journalBody.lines[0], credit: "1" }, journalBody.lines[1]] }, owner.cookie)).status, 400);
    const journal = await post("/api/ledger/journals", journalBody, manager.cookie);
    assert.equal(journal.status, 201); assert.equal(journal.data.entry.total, "12.345");
    assert.equal((await post("/api/ledger/journals", journalBody, owner.cookie)).status, 409);
    const ledgerQuery = `tenantId=${tenantId}&companyId=${companyA.data.company.id}`;
    assert.equal((await get(`/api/ledger/accounts?${ledgerQuery}`, accepted.cookie)).status, 403);
    assert.equal((await get(`/api/ledger/journals?${ledgerQuery}`, manager.cookie)).data.entries.length, 1);
    assert.equal((await get(`/api/ledger/trial-balance?${ledgerQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/ledger/trial-balance?${ledgerQuery}&from=2026-10-10&to=2026-10-01`, owner.cookie)).status, 400);
    const trial = await get(`/api/ledger/trial-balance?${ledgerQuery}`, manager.cookie);
    assert.equal(trial.status, 200); assert.equal(trial.data.scope, "BRANCHES");
    assert.equal(trial.data.rows.find((row) => row.code === "1000").debitBalance, "12.345");
    assert.equal(trial.data.rows.find((row) => row.code === "4000").creditBalance, "12.345");
    assert.deepEqual(trial.data.summary, [{currency:journal.data.entry.currency,debit:"12.345",credit:"12.345",debitBalance:"12.345",creditBalance:"12.345",balanced:true}]);
    const trialCsv = await fetch(`${origin}/api/ledger/trial-balance?${ledgerQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(trialCsv.status,200);assert.equal(trialCsv.headers.get("cache-control"),"private, no-store");
    const trialText=await trialCsv.text();assert.match(trialText,/TOTAL/);assert.match(trialText,/12\.345/);assert.match(trialText,/Cash/);
    assert.equal((await get(`/api/ledger/trial-balance?${ledgerQuery}&format=pdf`,manager.cookie)).status,400);
    assert.equal((await get(`/api/ledger/trial-balance?${ledgerQuery}&format=csv&format=json`,manager.cookie)).status,400);
    const reversalBody = { tenantId, number: "JE-REV-001", entryDate: "2026-10-02", reason: "Correct manual journal" };
    const reversalPath = `/api/ledger/journals/${journal.data.entry.id}/reverse`;
    assert.equal((await post(reversalPath, reversalBody, accepted.cookie)).status, 403);
    assert.equal((await post(reversalPath, { ...reversalBody, entryDate: "2026-09-30" }, manager.cookie)).status, 409);
    const reversal = await post(reversalPath, reversalBody, manager.cookie);
    assert.equal(reversal.status, 201); assert.equal(reversal.data.entry.reversalOf, journal.data.entry.id);
    assert.equal((await post(reversalPath, { ...reversalBody, number: "JE-REV-002" }, manager.cookie)).status, 409);
    assert.equal((await post(`/api/ledger/journals/${reversal.data.entry.id}/reverse`, { ...reversalBody, number: "JE-REV-003" }, owner.cookie)).status, 409);
    const clearedTrial = await get(`/api/ledger/trial-balance?${ledgerQuery}`, manager.cookie);
    assert.equal(clearedTrial.data.lineCount, 4);
    assert.equal(clearedTrial.data.rows.every((row) => row.debitBalance === "0.000" && row.creditBalance === "0.000"), true);
    const earlierTrial = await get(`/api/ledger/trial-balance?${ledgerQuery}&to=2026-10-01`, manager.cookie);
    assert.equal(earlierTrial.data.rows.find((row) => row.code === "1000").debitBalance, "12.345");
    assert.equal((await post("/api/ledger/journals", { ...journalBody, number: "JE-B", branchId: branchB.data.branch.id }, owner.cookie)).status, 201);
    assert.equal((await get(`/api/ledger/journals?${ledgerQuery}`, manager.cookie)).data.entries.length, 2);
    const statementPath = `/api/ledger/account-statement?${ledgerQuery}&accountId=${cash.data.account.id}&from=2026-10-02&to=2026-10-02`;
    const accountStatement = await get(statementPath, manager.cookie);
    assert.equal(accountStatement.status, 200);
    assert.equal(accountStatement.data.summary[0].opening, "12.345");
    assert.equal(accountStatement.data.summary[0].credit, "12.345");
    assert.equal(accountStatement.data.summary[0].closing, "0.000");
    assert.equal(accountStatement.data.rows[0].reversal, true);
    assert.equal(accountStatement.data.rows[0].balance, "0.000");
    assert.equal((await get(statementPath, accepted.cookie)).status, 403);
    assert.equal((await get(`${statementPath}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 403);
    assert.equal((await get(statementPath.replace(cash.data.account.id, foreignAccount.data.account.id), owner.cookie)).status, 404);
    const creditStatement = await get(statementPath.replace(cash.data.account.id, revenue.data.account.id), manager.cookie);
    assert.equal(creditStatement.data.summary[0].opening, "-12.345");
    assert.equal(creditStatement.data.summary[0].closing, "0.000");
    const openingOnly = await get(statementPath.replaceAll("2026-10-02", "2026-10-03"), owner.cookie);
    assert.equal(openingOnly.data.rows.length, 0);
    assert.equal(openingOnly.data.summary[0].opening, "12.345");
    const statementCsv = await fetch(`${origin}${statementPath}&format=csv`, {headers:{Cookie:manager.cookie}});
    assert.equal(statementCsv.status, 200);
    const statementText = await statementCsv.text();
    assert.match(statementText, /OPENING/); assert.match(statementText, /CLOSING/); assert.match(statementText, /REVERSAL/);
    assert.equal((await get(`${statementPath}&from=2020-01-01`, owner.cookie)).status, 400);
    for (const [entryId,number,relatedNumber] of [[journal.data.entry.id,"JE-001","JE-REV-001"],[reversal.data.entry.id,"JE-REV-001","JE-001"]]) {
      const journalDocument = await fetch(`${origin}/accounting/ledger/journals/${entryId}`, {headers:{Cookie:manager.cookie}});
      assert.equal(journalDocument.status, 200);
      const journalHtml = await journalDocument.text();
      assert.match(journalHtml,new RegExp(number));assert.match(journalHtml,new RegExp(relatedNumber));assert.match(journalHtml,/12\.345/);
      assert.equal((await fetch(`${origin}/accounting/ledger/journals/${entryId}`, {headers:{Cookie:accepted.cookie}})).status,404);
    }
    const otherBranchJournal = (await get(`/api/ledger/journals?${ledgerQuery}&branchId=${branchB.data.branch.id}`,owner.cookie)).data.entries[0];
    assert.equal((await fetch(`${origin}/accounting/ledger/journals/${otherBranchJournal.id}`,{headers:{Cookie:manager.cookie}})).status,404);
    const ledgerPage = await fetch(`${origin}/accounting/ledger`, { headers: { Cookie: owner.cookie } });
    assert.equal(ledgerPage.status, 200);
    const incomeQuery = `/api/ledger/income-statement?${ledgerQuery}&from=2026-10-01&to=2026-10-02`;
    const incomeBeforeCost = await get(incomeQuery,manager.cookie);
    assert.equal(incomeBeforeCost.status,200);
    assert.deepEqual(incomeBeforeCost.data.summary,[{currency:journal.data.entry.currency,revenue:"0.000",expenses:"0.000",netIncome:"0.000"}]);
    const costAccount=await post("/api/ledger/accounts",{...accountScope,code:"5000",name:"=Office cost",type:"EXPENSE"},owner.cookie);
    assert.equal(costAccount.status,201);
    const costJournal=await post("/api/ledger/journals",{...journalBody,number:"JE-COST",description:"Manual office cost",lines:[{accountId:costAccount.data.account.id,debit:"4.125",credit:"0"},{accountId:cash.data.account.id,debit:"0",credit:"4.125"}]},manager.cookie);
    assert.equal(costJournal.status,201);
    const branchIncome=await get(incomeQuery,manager.cookie);
    assert.equal(branchIncome.data.scope,"BRANCHES");
    assert.deepEqual(branchIncome.data.summary,[{currency:journal.data.entry.currency,revenue:"0.000",expenses:"4.125",netIncome:"-4.125"}]);
    assert.equal(branchIncome.data.rows.some(row=>row.code==="1000"),false);
    const companyIncome=await get(incomeQuery,owner.cookie);
    assert.equal(companyIncome.data.scope,"COMPANY");
    assert.deepEqual(companyIncome.data.summary,[{currency:journal.data.entry.currency,revenue:"12.345",expenses:"4.125",netIncome:"8.220"}]);
    const firstDayIncome=await get(incomeQuery.replace("to=2026-10-02","to=2026-10-01"),manager.cookie);
    assert.equal(firstDayIncome.data.summary[0].netIncome,"8.220");
    assert.equal((await get(incomeQuery,accepted.cookie)).status,403);
    assert.equal((await get(`${incomeQuery}&branchId=${branchB.data.branch.id}`,manager.cookie)).status,403);
    assert.equal((await get(`${incomeQuery}&format=pdf`,owner.cookie)).status,400);
    assert.equal((await get(`${incomeQuery}&from=2020-01-01`,owner.cookie)).status,400);
    const incomeCsv=await fetch(`${origin}${incomeQuery}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(incomeCsv.status,200);assert.equal(incomeCsv.headers.get("cache-control"),"private, no-store");
    const incomeCsvText=await incomeCsv.text();assert.match(incomeCsvText,/'=Office cost/);assert.match(incomeCsvText,/NET INCOME/);assert.match(incomeCsvText,/'-4\.125/);

    const balanceSheetPath=`/api/ledger/balance-sheet?${ledgerQuery}&to=2026-10-02`;
    const companyBalanceSheet=await get(balanceSheetPath,owner.cookie);
    assert.equal(companyBalanceSheet.status,200);
    assert.deepEqual(companyBalanceSheet.data.summary,[{currency:journal.data.entry.currency,assets:"8.220",liabilities:"0.000",equity:"0.000",earnings:"8.220",equityAndEarnings:"8.220",difference:"0.000",balanced:true}]);
    const branchBalanceSheet=await get(balanceSheetPath,manager.cookie);
    assert.equal(branchBalanceSheet.data.summary[0].assets,"-4.125");
    assert.equal(branchBalanceSheet.data.summary[0].earnings,"-4.125");
    assert.equal(branchBalanceSheet.data.summary[0].balanced,true);
    assert.equal((await get(balanceSheetPath,accepted.cookie)).status,403);
    assert.equal((await get(`${balanceSheetPath}&branchId=${branchB.data.branch.id}`,manager.cookie)).status,403);
    assert.equal((await get(`${balanceSheetPath}&to=2026-10-03`,owner.cookie)).status,400);
    assert.equal((await get(balanceSheetPath.replace("2026-10-02","2026-02-30"),owner.cookie)).status,400);
    const retainedAccount=await post("/api/ledger/accounts",{...accountScope,code:"3000",name:"Retained earnings",type:"EQUITY"},owner.cookie);
    assert.equal(retainedAccount.status,201);
    const closeJournal=await post("/api/ledger/journals",{...journalBody,number:"JE-CLOSE",entryDate:"2026-10-03",description:"Close branch expense balance",lines:[{accountId:retainedAccount.data.account.id,debit:"4.125",credit:"0"},{accountId:costAccount.data.account.id,debit:"0",credit:"4.125"}]},owner.cookie);
    assert.equal(closeJournal.status,201);
    const closedBalanceSheet=await get(balanceSheetPath.replace("2026-10-02","2026-10-03"),manager.cookie);
    assert.equal(closedBalanceSheet.data.summary[0].earnings,"0.000");
    assert.equal(closedBalanceSheet.data.summary[0].equity,"-4.125");
    assert.equal(closedBalanceSheet.data.summary[0].assets,"-4.125");
    assert.equal(closedBalanceSheet.data.summary[0].balanced,true);
    assert.equal((await get(balanceSheetPath,manager.cookie)).data.summary[0].earnings,"-4.125");
    const loanAccount=await post("/api/ledger/accounts",{...accountScope,code:"2000",name:"Loan",type:"LIABILITY"},owner.cookie);
    assert.equal(loanAccount.status,201);
    assert.equal((await post("/api/ledger/journals",{...journalBody,number:"JE-FUND",entryDate:"2026-10-04",description:"Loan and equity funding",lines:[{accountId:cash.data.account.id,debit:"10",credit:"0"},{accountId:loanAccount.data.account.id,debit:"0",credit:"6"},{accountId:retainedAccount.data.account.id,debit:"0",credit:"4"}]},owner.cookie)).status,201);
    const fundedBalanceSheet=await get(balanceSheetPath.replace("2026-10-02","2026-10-04"),manager.cookie);
    assert.deepEqual(fundedBalanceSheet.data.summary,[{currency:journal.data.entry.currency,assets:"5.875",liabilities:"6.000",equity:"-0.125",earnings:"0.000",equityAndEarnings:"-0.125",difference:"0.000",balanced:true}]);
    const balanceCsv=await fetch(`${origin}${balanceSheetPath}&format=csv`,{headers:{Cookie:manager.cookie}});
    assert.equal(balanceCsv.status,200);assert.equal(balanceCsv.headers.get("cache-control"),"private, no-store");
    const balanceCsvText=await balanceCsv.text();assert.match(balanceCsvText,/EARNINGS/);assert.match(balanceCsvText,/'=Office cost/);assert.match(balanceCsvText,/'-4\.125/);

    const posScope = { tenantId, companyId: companyA.data.company.id, branchId: branchA.data.branch.id };
    const menuBody = { ...posScope, code: "MENU-A", name: "Coffee", category: "Drinks", price: "1.125" };
    assert.equal((await post("/api/pos/items", menuBody, accepted.cookie)).status, 403);
    const menuItem = await post("/api/pos/items", menuBody, manager.cookie);
    assert.equal(menuItem.status, 201);
    const sharedMenu = await post("/api/pos/items", { ...menuBody, code: "MENU-SHARED", branchId: null }, owner.cookie);
    assert.equal(sharedMenu.status, 201);
    const otherMenu = await post("/api/pos/items", { ...menuBody, code: "MENU-B", branchId: branchB.data.branch.id }, owner.cookie);
    assert.equal(otherMenu.status, 201);
    assert.equal((await post("/api/pos/items", { ...menuBody, code: "MENU-DENIED", branchId: null }, manager.cookie)).status, 403);
    const posQuery = new URLSearchParams(posScope);
    const visibleMenu = await get(`/api/pos/items?${posQuery}`, accepted.cookie);
    assert.deepEqual(visibleMenu.data.items.map((item) => item.id).sort(), [menuItem.data.item.id, sharedMenu.data.item.id].sort());
    const posBody = { ...posScope, number: "POS-001", type: "DINE_IN", tableLabel: "Table 4", lines: [{ itemId: menuItem.data.item.id, quantity: 3 }] };
    assert.equal((await post("/api/pos/orders", posBody, accepted.cookie)).status, 403);
    assert.equal((await post("/api/pos/orders", { ...posBody, tableLabel: null }, manager.cookie)).status, 400);
    assert.equal((await post("/api/pos/orders", { ...posBody, lines: [{ itemId: otherMenu.data.item.id, quantity: 1 }] }, manager.cookie)).status, 409);
    assert.equal((await post("/api/pos/orders", { ...posBody, lines: [posBody.lines[0], posBody.lines[0]] }, manager.cookie)).status, 400);
    const posOrder = await post("/api/pos/orders", posBody, manager.cookie);
    assert.equal(posOrder.status, 201); assert.equal(posOrder.data.order.total, "3.375");
    assert.equal((await post("/api/pos/orders", posBody, manager.cookie)).status, 409);
    const posOrderPath = `/api/pos/orders/${posOrder.data.order.id}`;
    assert.equal((await patch(posOrderPath, { tenantId, action: "pay", method: "CASH", tendered: "3" }, manager.cookie)).status, 400);
    assert.equal((await patch(posOrderPath, { tenantId, action: "pay", method: "CASH", tendered: "5" }, accepted.cookie)).status, 403);
    assert.equal((await patch(posOrderPath, { tenantId, action: "pay", method: "CASH", tendered: "5" }, manager.cookie)).status, 200);
    assert.equal((await patch(posOrderPath, { tenantId, action: "pay-card", reference: "CARD-001" }, manager.cookie)).status, 409);
    assert.equal((await patch(posOrderPath, { tenantId, action: "cancel", reason: "Cannot cancel paid" }, owner.cookie)).status, 409);
    const paidPos = await get(`/api/pos/orders?${posQuery}&status=PAID`, accepted.cookie);
    assert.equal(paidPos.data.orders[0].change, "1.625");
    const posReceipt = await fetch(`${origin}/pos/${posOrder.data.order.id}`, { headers: { Cookie: accepted.cookie } });
    assert.equal(posReceipt.status, 200); assert.match(await posReceipt.text(), /3\.375/);
    const branchBPos = await post("/api/pos/orders", { ...posBody, branchId: branchB.data.branch.id, number: "POS-B", lines: [{ itemId: otherMenu.data.item.id, quantity: 1 }] }, owner.cookie);
    assert.equal(branchBPos.status, 201);
    assert.equal((await fetch(`${origin}/pos/${branchBPos.data.order.id}`, { headers: { Cookie: manager.cookie } })).status, 404);
    assert.equal((await get(`/api/pos/orders?${posQuery}&branchId=${branchB.data.branch.id}`, manager.cookie)).status, 400);
    assert.equal((await get(`/api/pos/orders?${new URLSearchParams({ ...posScope, branchId: branchB.data.branch.id })}`, manager.cookie)).status, 403);
    const cardOrder = await post("/api/pos/orders", { ...posBody, number: "POS-CARD", type: "TAKEAWAY", tableLabel: null }, manager.cookie);
    assert.equal(cardOrder.status, 201);
    const competingPayments = await Promise.all(["CARD-002", "CARD-003"].map((reference) => patch(`/api/pos/orders/${cardOrder.data.order.id}`, { tenantId, action: "pay-card", reference }, manager.cookie)));
    assert.deepEqual(competingPayments.map((result) => result.status).sort(), [200, 409]);
    const cancelledPosOrder = await post("/api/pos/orders", { ...posBody, number: "POS-CANCEL" }, manager.cookie);
    assert.equal((await patch(`/api/pos/orders/${cancelledPosOrder.data.order.id}`, { tenantId, action: "cancel", reason: "Customer changed plans" }, manager.cookie)).status, 200);
    assert.equal((await patch(`/api/pos/items/${menuItem.data.item.id}`, { tenantId, active: false }, manager.cookie)).status, 200);
    assert.equal((await post("/api/pos/orders", { ...posBody, number: "POS-INACTIVE" }, manager.cookie)).status, 409);
    assert.equal((await get(`/api/pos/items?${posQuery}`, manager.cookie)).data.items.some((item) => item.id === menuItem.data.item.id), false);
    assert.equal((await get(`/api/pos/orders?${posQuery}`, manager.cookie)).data.orders.find((order) => order.id === posOrder.data.order.id).lines[0].itemName, "Coffee");

    const reportPosOrder = await post("/api/pos/orders", { ...posBody, number: "POS-REPORT", type: "TAKEAWAY", tableLabel: null, lines: [{ itemId: sharedMenu.data.item.id, quantity: 1 }] }, manager.cookie);
    assert.equal(reportPosOrder.status, 201);
    assert.equal((await patch(`/api/pos/orders/${reportPosOrder.data.order.id}`, { tenantId, action: "pay-card", reference: "=1+1" }, manager.cookie)).status, 200);
    const muscatToday = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
    const posReportQuery = new URLSearchParams({ ...posScope, from: muscatToday, to: muscatToday, timeZone: "Asia/Muscat" });
    const salesReport = await get(`/api/pos/report?${posReportQuery}`, manager.cookie);
    assert.equal(salesReport.status, 200); assert.equal(salesReport.data.count, 3);
    const cashSales = salesReport.data.summary.find((group) => group.method === "CASH");
    assert.equal(cashSales.total, "3.375"); assert.equal(cashSales.cashReceived, "5.000"); assert.equal(cashSales.change, "1.625");
    assert.equal(salesReport.data.summary.find((group) => group.method === "CARD").total, "4.500");
    assert.equal((await get(`/api/pos/report?${new URLSearchParams({ ...posScope, branchId: branchB.data.branch.id, from: muscatToday, to: muscatToday })}`, manager.cookie)).status, 403);
    assert.equal((await get(`/api/pos/report?${posReportQuery}&timeZone=UTC`, manager.cookie)).status, 400);
    assert.equal((await get(`/api/pos/report?${new URLSearchParams({ ...posScope, from: "2026-10-01", to: "2026-11-01" })}`, owner.cookie)).status, 400);
    assert.equal((await get(`/api/pos/report?${new URLSearchParams({ ...posScope, from: "2000-01-01", to: "2000-01-01" })}`, manager.cookie)).data.count, 0);
    const posReportCsv = await fetch(`${origin}/api/pos/report?${posReportQuery}&format=csv`, { headers: { Cookie: accepted.cookie } });
    assert.equal(posReportCsv.status, 200); assert.match(posReportCsv.headers.get("content-type"), /text\/csv/);
    const salesCsvText = await posReportCsv.text();
    assert.match(salesCsvText, /"'=1\+1"/); assert.match(salesCsvText, /"3\.375"/);
    assert.equal(salesCsvText.includes("POS-CANCEL"), false); assert.equal(salesCsvText.includes('"POS-B"'), false);

    const menuEditPath = `/api/pos/items/${menuItem.data.item.id}`;
    assert.equal((await patch(menuEditPath, { tenantId, name: "New coffee" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/pos/items/${otherMenu.data.item.id}`, { tenantId, price: "2.125" }, manager.cookie)).status, 403);
    assert.equal((await patch(menuEditPath, { tenantId }, manager.cookie)).status, 400);
    assert.equal((await patch(menuEditPath, { tenantId, price: "0" }, manager.cookie)).status, 400);
    assert.equal((await patch(menuEditPath, { tenantId, companyId: companyB.data.company.id }, manager.cookie)).status, 400);
    assert.equal((await patch(menuEditPath, { tenantId, active: true, name: "New coffee", category: "Hot drinks", price: "2.125" }, manager.cookie)).status, 200);
    const repricedPos = await post("/api/pos/orders", { ...posBody, number: "POS-REPRICED" }, manager.cookie);
    assert.equal(repricedPos.status, 201); assert.equal(repricedPos.data.order.total, "6.375");
    assert.equal(repricedPos.data.order.lines[0].itemName, "New coffee");
    const historicPos = (await get(`/api/pos/orders?${posQuery}`, manager.cookie)).data.orders.find((order) => order.id === posOrder.data.order.id);
    assert.equal(historicPos.total, "3.375"); assert.equal(historicPos.lines[0].itemName, "Coffee"); assert.equal(historicPos.lines[0].unitPrice, "1.125");

    const kitchenOrderPath = `/api/pos/orders/${posOrder.data.order.id}/kitchen`;
    assert.equal((await patch(kitchenOrderPath, { tenantId, status: "PREPARING" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/pos/orders/${branchBPos.data.order.id}/kitchen`, { tenantId, status: "PREPARING" }, manager.cookie)).status, 403);
    assert.equal((await patch(kitchenOrderPath, { tenantId, status: "READY" }, manager.cookie)).status, 409);
    const kitchenStarts = await Promise.all([1,2].map(() => patch(kitchenOrderPath, { tenantId, status: "PREPARING" }, manager.cookie)));
    assert.deepEqual(kitchenStarts.map((result) => result.status).sort(), [200,409]);
    assert.equal((await patch(kitchenOrderPath, { tenantId, status: "READY" }, manager.cookie)).status, 200);
    const readyKitchen = await get(`/api/pos/kitchen?${posQuery}&status=READY`, accepted.cookie);
    assert.ok(Number.isFinite(Date.parse(readyKitchen.data.serverTime)));
    const readyGroup = readyKitchen.data.summary.find(group => group.status === "READY");
    assert.equal(readyGroup.count, 1);
    assert.equal(readyGroup.oldestStageAt, readyKitchen.data.orders[0].readyAt);
    const kitchenBeyondPage = await get(`/api/pos/kitchen?${posQuery}&status=READY&page=1`, accepted.cookie);
    assert.equal(kitchenBeyondPage.data.orders.length, 0);
    assert.deepEqual(kitchenBeyondPage.data.summary, readyKitchen.data.summary);
    assert.equal(readyKitchen.status, 200); assert.equal(readyKitchen.data.orders[0].id, posOrder.data.order.id);
    assert.equal(readyKitchen.data.orders[0].status, "PAID");
    assert.equal(readyKitchen.data.orders[0].lines[0].itemName, "Coffee");
    assert.equal("total" in readyKitchen.data.orders[0], false);
    assert.equal((await patch(kitchenOrderPath, { tenantId, status: "SERVED" }, manager.cookie)).status, 200);
    assert.equal((await patch(kitchenOrderPath, { tenantId, status: "PREPARING" }, manager.cookie)).status, 409);
    assert.equal((await get(`/api/pos/kitchen?${posQuery}`, manager.cookie)).data.orders.some((order) => order.id === posOrder.data.order.id || order.id === cancelledPosOrder.data.order.id), false);
    assert.equal((await get(`/api/pos/kitchen?${posQuery}&status=SERVED`, manager.cookie)).data.orders[0].id, posOrder.data.order.id);
    assert.equal((await patch(`/api/pos/orders/${cancelledPosOrder.data.order.id}/kitchen`, { tenantId, status: "PREPARING" }, manager.cookie)).status, 409);
    assert.equal((await get(`/api/pos/kitchen?${new URLSearchParams({...posScope,branchId:branchB.data.branch.id})}`, manager.cookie)).status, 403);
    const posAfterPreparation = (await get(`/api/pos/orders?${posQuery}`, manager.cookie)).data.orders.find((order) => order.id === posOrder.data.order.id);
    assert.equal(posAfterPreparation.total, "3.375"); assert.equal(posAfterPreparation.change, "1.625"); assert.equal(posAfterPreparation.paymentMethod, "CASH");
    assert.ok(posAfterPreparation.prepStartedAt && posAfterPreparation.readyAt && posAfterPreparation.servedAt);
    assert.equal((await fetch(`${origin}/pos/kitchen`, { headers: { Cookie: accepted.cookie } })).status, 200);

    const throttleEmail = `throttle-${suffix()}@example.invalid`;
    const throttleActor = await post("/api/auth/register", {name:"Throttle test",email:throttleEmail,password,organization:"Throttle test",slug:`throttle-${suffix()}`});
    assert.equal(throttleActor.status, 201);
    const firstLogin = await post("/api/auth/login", {email:throttleEmail,password});
    assert.equal(firstLogin.status, 200);
    assert.ok(firstLogin.cookie);
    const failedLogins = await Promise.all(Array.from({length:4},()=>post("/api/auth/login",{email:throttleEmail.toUpperCase(),password:"wrong"})));
    assert.ok(failedLogins.every(result=>result.status===401));
    const blockedLogin = await fetch(`${origin}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:throttleEmail,password})});
    assert.equal(blockedLogin.status, 429);
    assert.ok(Number(blockedLogin.headers.get("retry-after"))>0);
    assert.equal(blockedLogin.headers.get("set-cookie"), null);
    const throttleDb = new PrismaClient();
    try {
      const throttleKey = createHash("sha256").update(`login:${throttleEmail.toLowerCase()}`).digest("hex");
      assert.equal((await throttleDb.loginThrottle.findUnique({where:{keyHash:throttleKey}})).attempts, 6);
      await throttleDb.loginThrottle.update({where:{keyHash:throttleKey},data:{expiresAt:new Date(Date.now()-1000)}});
      assert.equal((await post("/api/auth/login",{email:throttleEmail,password})).status, 200);
      assert.equal((await throttleDb.loginThrottle.findUnique({where:{keyHash:throttleKey}})).attempts, 1);
    } finally {await throttleDb.$disconnect();}
    const unknownEmail = `unknown-${suffix()}@example.invalid`;
    const unknownLogins = await Promise.all(Array.from({length:6},()=>post("/api/auth/login",{email:unknownEmail,password:"wrong"})));
    assert.deepEqual(unknownLogins.map(result=>result.status).sort(),[401,401,401,401,401,429]);
    const securityEmail = `security-${suffix()}@example.invalid`;
    const securityActor = await post("/api/auth/register", {name:"Security test",email:securityEmail,password,organization:"Security test",slug:`security-${suffix()}`});
    assert.equal(securityActor.status, 201);
    const extraSecuritySession = await post("/api/auth/login",{email:securityEmail,password});
    assert.equal(extraSecuritySession.status, 200);
    const newSecurityPassword = "New-secure-password-2026";
    assert.equal((await post("/api/auth/password",{currentPassword:password,newPassword:newSecurityPassword})).status, 401);
    assert.equal((await post("/api/auth/password",{currentPassword:password,newPassword:"short"},securityActor.cookie)).status, 400);
    assert.equal((await post("/api/auth/password",{currentPassword:password,newPassword:password},securityActor.cookie)).status, 400);
    assert.equal((await post("/api/auth/password",{currentPassword:"incorrect",newPassword:newSecurityPassword},securityActor.cookie)).status, 403);
    const securityPage = await fetch(`${origin}/settings/security`,{headers:{Cookie:securityActor.cookie}});
    assert.equal(securityPage.status, 200);
    assert.match(await securityPage.text(), /security-/);
    const securityChanges = await Promise.all(Array.from({length:2},()=>post("/api/auth/password",{currentPassword:password,newPassword:newSecurityPassword},securityActor.cookie)));
    assert.equal(securityChanges.filter(result=>result.status===200).length, 1);
    assert.ok(securityChanges.every(result=>[200,401,403,409].includes(result.status)));
    assert.equal((await get(`/api/companies?tenantId=${securityActor.data.tenantId}`,securityActor.cookie)).status, 401);
    assert.equal((await get(`/api/companies?tenantId=${securityActor.data.tenantId}`,extraSecuritySession.cookie)).status, 401);
    assert.equal((await get(`/api/companies?tenantId=${tenantId}`,owner.cookie)).status, 200);
    assert.equal((await post("/api/auth/login",{email:securityEmail,password})).status, 401);
    const newSecuritySession = await post("/api/auth/login",{email:securityEmail,password:newSecurityPassword});
    assert.equal(newSecuritySession.status, 200);
    assert.ok(newSecuritySession.cookie);
    assert.equal((await get(`/api/companies?tenantId=${securityActor.data.tenantId}`,newSecuritySession.cookie)).status, 200);
  } finally {
    server.kill("SIGTERM");
  }
});
