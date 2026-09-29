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
    const statusPath = `/api/quotes/${quote.data.quote.id}/status`;
    assert.equal((await patch(statusPath, { tenantId, action: "send" }, accepted.cookie)).status, 403);
    assert.equal((await patch(`/api/quotes/${quoteB.data.quote.id}/status`, { tenantId, action: "send" }, manager.cookie)).status, 403);
    assert.equal((await patch(statusPath, { tenantId, action: "accept" }, manager.cookie)).status, 409);
    const sentQuote = await patch(statusPath, { tenantId, action: "send" }, manager.cookie);
    assert.equal(sentQuote.status, 200);
    assert.equal(sentQuote.data.quote.status, "SENT");
    assert.ok(sentQuote.data.quote.sentAt);
    assert.equal((await patch(statusPath, { tenantId, action: "send" }, manager.cookie)).status, 409);
    const acceptedQuote = await patch(statusPath, { tenantId, action: "accept" }, manager.cookie);
    assert.equal(acceptedQuote.status, 200);
    assert.equal(acceptedQuote.data.quote.status, "ACCEPTED");
    assert.ok(acceptedQuote.data.quote.decidedAt);
    assert.equal((await patch(statusPath, { tenantId, action: "reject" }, manager.cookie)).status, 409);
    const rejectedPath = `/api/quotes/${quoteB.data.quote.id}/status`;
    assert.equal((await patch(rejectedPath, { tenantId, action: "send" }, owner.cookie)).status, 200);
    assert.equal((await patch(rejectedPath, { tenantId, action: "reject" }, owner.cookie)).status, 200);

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
