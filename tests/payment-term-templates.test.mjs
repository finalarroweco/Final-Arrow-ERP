import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { paymentTermDueDate } from "../src/lib/payment-term-date.ts";
const origin = "http://127.0.0.1:3245";
async function call(path, method = "GET", body, cookie) {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
test("company payment templates are immutable, audited, scoped and safe to copy into source documents", { timeout: 120000 }, async () => {
  const db = new PrismaClient(), server = spawn("./node_modules/.bin/next", ["start", "-p", "3245"], { env: { ...process.env, ALLOW_REGISTRATION: "true" }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    let ready = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); } assert.ok(ready);
    async function owner() { const suffix = randomUUID().slice(0, 8), result = await call("/api/auth/register", "POST", { name: "Terms owner", email: `terms-${suffix}@example.invalid`, password: "Terms-owner-password-2026", organization: "Terms QA", slug: `terms-${suffix}` }); assert.equal(result.status, 201); return result; }
    const actor = await owner(), outsider = await owner(), tenantId = actor.data.tenantId, cookie = actor.cookie;
    const create = async (path, body) => { const result = await call(path, "POST", { tenantId, ...body }, cookie); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data; };
    const { company } = await create("/api/companies", { name: "Terms company", code: "TERMS", baseCurrency: "OMR" }), companyId = company.id;
    const { company: otherCompany } = await create("/api/companies", { name: "Other terms", code: "OTHER", baseCurrency: "OMR" });
    const { branch } = await create("/api/branches", { companyId, name: "Main", code: "MAIN" });
    const { role } = await create("/api/roles", { name: "Branch terms manager", permissions: ["payment-term:read", "payment-term:manage"] });
    async function invite(roleName, roleId, type = "BRANCH") { const invitation = await create("/api/invitations", { email: `terms-member-${randomUUID().slice(0, 8)}@example.invalid`, ...(roleId ? { roleId } : { role: roleName }), scope: { type, companyId, ...(type === "BRANCH" ? { branchId: branch.id } : {}) } }); const result = await call("/api/invitations/accept", "POST", { token: invitation.path.split("/").at(-1), name: "Terms reader", password: "Terms-reader-password-2026" }); assert.equal(result.status, 200); return result.cookie; }
    const reader = await invite("Viewer"), branchManager = await invite(undefined, role.id), manager = await invite("Manager", undefined, "COMPANY");
    const path = "/api/payment-term-templates", query = "?" + new URLSearchParams({ tenantId, companyId });
    const body = { action: "create", tenantId, companyId, requestId: randomUUID(), name: "  Supplier Net 30  ", label: "  Agreed net 30 calendar days  ", days: 30 };
    assert.equal((await call(path + query)).status, 401); assert.equal((await call(path, "POST", body)).status, 401);
    for (const account of [reader, branchManager, manager, outsider.cookie]) assert.equal((await call(path, "POST", body, account)).status, 403);
    assert.equal((await call(path + query, "GET", undefined, outsider.cookie)).status, 403);
    assert.equal((await call(path + query.replace(companyId, otherCompany.id), "GET", undefined, reader)).status, 403);
    const race = await Promise.all([call(path, "POST", body, cookie), call(path, "POST", { ...body, requestId: body.requestId.toUpperCase() }, cookie)]);
    assert.ok(race.every(result => result.status === 201), JSON.stringify(race)); assert.deepEqual(race.map(result => result.data.replayed).sort(), [false, true]);
    const template = race[0].data.template; assert.equal(template.name, "Supplier Net 30"); assert.equal(template.label, "Agreed net 30 calendar days");
    assert.equal((await call(path, "POST", { ...body, days: 60 }, cookie)).status, 409);
    assert.equal((await call(path, "POST", { ...body, requestId: randomUUID(), name: "supplier net 30" }, cookie)).status, 409);
    const list = await call(path + query, "GET", undefined, reader); assert.equal(list.status, 200); assert.equal(list.data.templates[0].id, template.id);
    for (const suffix of ["&page=1&page=2", "&branchId=" + branch.id, "&state=DELETED"]) assert.equal((await call(path + query + suffix, "GET", undefined, reader)).status, 400);
    for (const patch of [{ days: -1 }, { days: 3651 }, { days: 1.5 }, { label: "xx" }, { branchId: branch.id }]) assert.equal((await call(path, "POST", { ...body, ...patch }, cookie)).status, 400);
    const active = await db.paymentTermTemplate.findUnique({ where: { id: template.id } }), userId = active.createdBy;
    for (const data of [{ name: "Edited name" }, { days: 60 }, { label: "Edited label" }, { companyId: otherCompany.id }, { createdBy: randomUUID() }]) await assert.rejects(db.paymentTermTemplate.update({ where: { id: template.id }, data }));
    await assert.rejects(db.paymentTermTemplate.delete({ where: { id: template.id } }));
    await assert.rejects(db.paymentTermTemplate.create({ data: { id: randomUUID(), tenantId, companyId, name: "No transaction audit", label: "No audit label", days: 7, createdBy: userId } }));
    await assert.rejects(db.paymentTermTemplate.update({ where: { id: template.id }, data: { archivedBy: userId, archiveRequestId: randomUUID(), archiveReason: "Missing audit" } }));
    // Copying is explicit input preparation. Existing source fields keep independent immutable snapshots.
    const { customer } = await create("/api/customers", { companyId, branchId: branch.id, code: "C", displayName: "Terms customer" });
    const { quote } = await create("/api/quotes", { companyId, branchId: branch.id, customerId: customer.id, number: "TERM-Q", lines: [{ description: "Service", quantity: 1, unitPrice: "5" }] });
    for (const action of ["send", "accept"]) assert.equal((await call(`/api/quotes/${quote.id}/status`, "PATCH", { tenantId, action }, cookie)).status, 200);
    const { order } = await create(`/api/quotes/${quote.id}/order`, { number: "TERM-O" });
    for (const action of ["start", "complete"]) assert.equal((await call(`/api/orders/${order.id}/status`, "PATCH", { tenantId, action }, cookie)).status, 200);
    const dueDate = paymentTermDueDate("2026-01-31", template.days);
    const { invoice } = await create(`/api/orders/${order.id}/invoice`, { number: "TERM-INV", paymentTerms: { label: template.label, dueDate } }); assert.equal(dueDate, "2026-03-02");
    const archive = { action: "archive", tenantId, companyId, templateId: template.id, requestId: randomUUID(), reason: "Replaced agreed terms" };
    assert.equal((await call(path, "POST", { ...archive, companyId: otherCompany.id }, cookie)).status, 404);
    const archives = await Promise.all([call(path, "POST", archive, cookie), call(path, "POST", archive, cookie)]); assert.ok(archives.every(result => result.status === 200), JSON.stringify(archives)); assert.deepEqual(archives.map(result => result.data.replayed).sort(), [false, true]);
    assert.equal((await call(path, "POST", { ...archive, requestId: randomUUID() }, cookie)).status, 409);
    assert.equal((await call(path, "POST", body, cookie)).data.replayed, true, "create retry survives archive");
    assert.equal((await call(path + query, "GET", undefined, reader)).data.templates.length, 0);
    assert.equal((await call(path + query + "&state=ARCHIVED", "GET", undefined, reader)).data.templates[0].archiveReason, archive.reason);
    await assert.rejects(db.paymentTermTemplate.update({ where: { id: template.id }, data: { archivedAt: null } }));
    const savedInvoice = await db.invoice.findUnique({ where: { id: invoice.id } }); assert.equal(savedInvoice.paymentTerms, template.label); assert.equal(savedInvoice.paymentDueDate.toISOString().slice(0, 10), dueDate);
    const replacement = await call(path, "POST", { ...body, requestId: randomUUID(), days: 60 }, cookie); assert.equal(replacement.status, 201); assert.equal((await db.invoice.findUnique({ where: { id: invoice.id } })).paymentTerms, template.label);
    // Long immutable history exercises paginated reading and the database-enforced lifetime limit.
    await db.$transaction(async tx => {
      const [clock] = await tx.$queryRaw`SELECT txid_current()::text AS transaction`;
      const data = Array.from({ length: 998 }, (_, index) => ({ id: randomUUID(), tenantId, companyId, name: `Terms ${index}`, label: "Explicit template agreement", days: index % 366, createdBy: userId }));
      await tx.paymentTermTemplate.createMany({ data });
      await tx.auditLog.createMany({ data: data.map(row => ({ tenantId, actorId: userId, entity: "PaymentTermTemplate", entityId: row.id, action: "payment-term.created", metadata: { companyId, transaction: clock.transaction } })) });
    }, { timeout: 30000 });
    const long = await call(path + query + "&state=ALL", "GET", undefined, reader); assert.equal(long.data.templates.length, 50); assert.equal(long.data.nextPage, 1);
    const next = await call(path + query + "&state=ALL&page=1", "GET", undefined, reader); assert.equal(next.data.templates.length, 50); assert.equal(new Set([...long.data.templates, ...next.data.templates].map(row => row.id)).size, 100);
    assert.equal((await call(path, "POST", { ...body, name: "Beyond limit", requestId: randomUUID() }, cookie)).status, 409);
    assert.equal((await call(path, "POST", archive, cookie)).status, 200, "exact retry remains valid at the lifetime limit");
    const page = await fetch(origin + "/settings/payment-terms?" + new URLSearchParams({ scope: tenantId + ":" + companyId }), { headers: { Cookie: reader } }); assert.equal(page.status, 200); assert.match(await page.text(), /Terms company/);
    assert.equal((await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE oid='"PaymentTermTemplate"'::regclass`)[0].relrowsecurity, true);
    const ownerRole = await db.role.findUnique({ where: { tenantId_name: { tenantId, name: "Owner" } } });
    await db.rolePermission.delete({ where: { tenantId_roleId_permissionKey: { tenantId, roleId: ownerRole.id, permissionKey: "payment-term:manage" } } }); assert.equal((await call(path, "POST", body, cookie)).status, 403);
    const viewerRole = await db.role.findUnique({ where: { tenantId_name: { tenantId, name: "Viewer" } } });
    await db.rolePermission.delete({ where: { tenantId_roleId_permissionKey: { tenantId, roleId: viewerRole.id, permissionKey: "payment-term:read" } } }); assert.equal((await call(path + query, "GET", undefined, reader)).status, 403);
  } finally { server.kill("SIGTERM"); await db.$disconnect(); }
});
