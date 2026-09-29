import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const origin = "http://127.0.0.1:3217";
const suffix = () => randomUUID().slice(0, 8);
const password = "Long-test-password-2026";

async function post(path, body, cookie) {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function get(path, cookie) {
  const response = await fetch(origin + path, { headers: { Cookie: cookie } });
  return { status: response.status, data: await response.json() };
}

test("invitation is single-use and a branch viewer sees only their company and branch", { timeout: 90000 }, async () => {
  const server = spawn("./node_modules/.bin/next", ["start", "-p", "3217"], {
    env: { ...process.env, ALLOW_REGISTRATION: "true" },
    stdio: "ignore",
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
    const forbidden = await post("/api/branches", {
      tenantId, companyId: companyB.data.company.id, name: "No access", code: "DENY",
    }, accepted.cookie);
    assert.equal(forbidden.status, 403);
  } finally {
    server.kill("SIGTERM");
  }
});
