import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const origin = "http://127.0.0.1:3248";
async function call(path, method = "GET", body, cookie) {
 const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
 return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
test("private register presets keep current source permissions, range/status filters, audit and retry guarantees", { timeout: 120000 }, async () => {
 const db = new PrismaClient(), server = spawn("./node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", "3248"], { env: { ...process.env, ALLOW_REGISTRATION: "true" }, stdio: ["ignore", "ignore", "inherit"] });
 try {
  let ready = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); } assert.ok(ready);
  async function register() { const suffix = randomUUID().slice(0, 8), result = await call("/api/auth/register", "POST", { name: "Register owner", email: `register-${suffix}@example.invalid`, password: "Register-tests-password-2026", organization: "Register QA", slug: `register-${suffix}` }); assert.equal(result.status, 201); return result; }
  const actor = await register(), outsider = await register(), tenantId = actor.data.tenantId, cookie = actor.cookie;
  async function create(path, body) { const result = await call(path, "POST", { tenantId, ...body }, cookie); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data; }
  const { company } = await create("/api/companies", { name: "Register company", code: "REG" }), companyId = company.id;
  const { company: otherCompany } = await create("/api/companies", { name: "Other company", code: "OTHER" });
  const { branch } = await create("/api/branches", { companyId, name: "Visible branch", code: "MAIN" }), { branch: sibling } = await create("/api/branches", { companyId, name: "Hidden branch", code: "SIB" });
  const permissions = ["invoice:read", "expense:read", "quote:read", "order:read", "purchase-order:read"];
  const { role } = await create("/api/roles", { name: "Registers without ledger or party rights", permissions });
  async function invite() { const email = `register-reader-${randomUUID().slice(0, 8)}@example.invalid`, invitation = await create("/api/invitations", { email, roleId: role.id, scope: { type: "BRANCH", companyId, branchId: branch.id } }); const result = await call("/api/invitations/accept", "POST", { token: invitation.path.split("/").at(-1), name: "Register reader", password: "Register-reader-password-2026" }); assert.equal(result.status, 200); return result.cookie; }
  const member = await invite(), otherMember = await invite(), day = new Date().toISOString().slice(0, 10);
  // Real disposable expense fixtures prove branch filtering, search, status and CSV amounts.
  for (const [suffix, branchId, amount] of [["MAIN", branch.id, "7.125"], ["SIB", sibling.id, "11.125"], ["WIDE", undefined, "13.125"]]) await create("/api/expenses", { companyId, branchId, number: "REG-" + suffix, description: "Register test", category: "QA", amount, expenseDate: day });
  const path = "/api/saved-reports", scope = { tenantId, companyId, branchId: branch.id };
  const base = { ...scope, kind: "EXPENSE_REGISTER", name: "Private expense register", dateMode: "FIXED_RANGE", asOf: null, from: day, to: day, status: "DRAFT", q: "REG-", requestId: randomUUID() };
  assert.equal((await call(path, "POST", base)).status, 401); assert.equal((await call(path, "POST", base, outsider.cookie)).status, 403);
  for (const change of [{ branchId: sibling.id }, { companyId: otherCompany.id }, { kind: "CUSTOMER_AGING", dateMode: "TODAY_UTC", from: null, to: null, status: null }]) assert.equal((await call(path, "POST", { ...base, ...change }, member)).status, 403);
  for (const change of [{ status: "ISSUED" }, { from: "2026-02-30" }, { from: "2024-01-01", to: "2025-01-01" }, { dateMode: "TODAY_UTC", from: null, to: null }, { asOf: day }, { ownerId: randomUUID() }, { dateMode: "CURRENT_MONTH_UTC" }]) assert.equal((await call(path, "POST", { ...base, ...change }, member)).status, 400, JSON.stringify(change));
  const creates = await Promise.all([call(path, "POST", base, member), call(path, "POST", base, member)]);
  assert.ok(creates.every(result => result.status === 201), JSON.stringify(creates)); assert.deepEqual(creates.map(result => result.data.replayed).sort(), [false, true]);
  const preset = creates[0].data.preset, id = preset.id;
  assert.equal(preset.from, day); assert.equal(preset.to, day); assert.equal(preset.status, "DRAFT");
  assert.equal((await call(path, "POST", { ...base, status: "POSTED" }, member)).status, 409);
  const listPath = path + "?" + new URLSearchParams({ tenantId, companyId });
  assert.deepEqual((await call(listPath, "GET", undefined, otherMember)).data.presets, []); assert.deepEqual((await call(listPath, "GET", undefined, cookie)).data.presets, []);
  const open = (id, account = member) => fetch(`${origin}${path}/${id}/open?tenantId=${tenantId}`, { headers: { Cookie: account }, redirect: "manual" });
  for (const account of [cookie, otherMember, outsider.cookie]) assert.equal((await open(id, account)).status, 404);
  const opened = await open(id); assert.equal(opened.status, 303); const target = new URL(opened.headers.get("location"), origin);
  assert.equal(target.pathname, "/reports/register"); assert.equal(target.searchParams.get("kind"), "EXPENSE_REGISTER"); assert.equal(target.searchParams.get("branchId"), branch.id);
  const reportQuery = new URLSearchParams(target.searchParams); reportQuery.delete("kind");
  const report = await call("/api/expenses/report?" + reportQuery, "GET", undefined, member);
  assert.equal(report.status, 200); assert.equal(report.data.count, 1); assert.equal(report.data.summary[0].amount, "7.125"); assert.equal(report.data.summary[0].status, "DRAFT"); assert.equal(report.data.dateBasis, "expenseDate"); assert.equal(report.data.amountBasis, "netPlusNonDeductibleVAT");
  const csv = await fetch(origin + "/api/expenses/report?" + reportQuery + "&format=csv", { headers: { Cookie: member } }), csvText = await csv.text();
  assert.equal(csv.status, 200); assert.match(csvText, /REG-MAIN/); assert.match(csvText, /7\.125/); assert.doesNotMatch(csvText, /REG-SIB|REG-WIDE/);
  const allQuery = new URLSearchParams(reportQuery); allQuery.delete("branchId"); assert.equal((await call("/api/expenses/report?" + allQuery, "GET", undefined, member)).data.count, 1); assert.equal((await call("/api/expenses/report?" + allQuery, "GET", undefined, cookie)).data.count, 3);
  const noMatch = new URLSearchParams(reportQuery); noMatch.set("q", "No matching record"); assert.equal((await call("/api/expenses/report?" + noMatch, "GET", undefined, member)).data.count, 0);
  noMatch.set("q", "REG-"); noMatch.set("status", "POSTED"); assert.equal((await call("/api/expenses/report?" + noMatch, "GET", undefined, member)).data.count, 0);
  async function page(url, account = member, locale = "en") { const response = await fetch(url, { headers: { Cookie: account + "; fa_locale=" + locale } }); assert.equal(response.status, 200); return response.text(); }
  assert.match(await page(target), /Expense report/); assert.match(await page(target, member, "ar"), /تقرير المصاريف/);
  // No fallback workspace or broadened scope for forged, duplicated or revoked filters.
  for (const change of [{ companyId: otherCompany.id }, { branchId: sibling.id }, { kind: "CUSTOMER_AGING" }, { status: "ISSUED" }, { from: "2026-02-30" }, { redirect: "https://evil.invalid" }]) { const url = new URL(target); for (const [key, value] of Object.entries(change)) url.searchParams.set(key, value); assert.doesNotMatch(await page(url), /name="from"/); }
  const duplicate = new URL(target); duplicate.searchParams.append("companyId", companyId); assert.doesNotMatch(await page(duplicate), /name="from"/);
  const seed = new URL("/saved-reports", origin); for (const [key, value] of target.searchParams) seed.searchParams.set(key, value); seed.searchParams.set("dateMode", "FIXED_RANGE");
  assert.match(await page(seed), /Save report filters/);
  for (const change of [{ companyId: otherCompany.id }, { branchId: sibling.id }, { kind: "CUSTOMER_AGING" }, { status: "ISSUED" }, { companyId: randomUUID() }]) { const url = new URL(seed); for (const [key, value] of Object.entries(change)) url.searchParams.set(key, value); assert.match(await page(url), /Saved report filters unavailable/); }
  const duplicateSeed = new URL(seed); duplicateSeed.searchParams.append("kind", "EXPENSE_REGISTER"); assert.match(await page(duplicateSeed), /Saved report filters unavailable/);
  assert.match(await page(new URL("/saved-reports", origin)), /Save report filters/);
  const kinds = { INVOICE_REGISTER: "invoices", QUOTE_REGISTER: "quotes", SALES_ORDER_REGISTER: "orders", PURCHASE_ORDER_REGISTER: "purchase-orders" };
  const ids = { EXPENSE_REGISTER: id };
  for (const [kind, endpoint] of Object.entries(kinds)) {
   const result = await call(path, "POST", { ...base, kind, dateMode: "CURRENT_MONTH_UTC", from: null, to: null, status: null, branchId: null, q: "", requestId: randomUUID() }, member); assert.equal(result.status, 201, JSON.stringify(result.data)); ids[kind] = result.data.preset.id;
   const resultOpen = await open(result.data.preset.id); assert.equal(resultOpen.status, 303); const url = new URL(resultOpen.headers.get("location"), origin);
   assert.equal(url.searchParams.get("from"), day.slice(0, 7) + "-01"); assert.equal(url.searchParams.get("to"), day); assert.equal(url.searchParams.has("branchId"), false); assert.match(await page(url), /name="from"/);
   const query = new URLSearchParams(url.searchParams); query.delete("kind"); assert.equal((await call(`/api/${endpoint}/report?${query}`, "GET", undefined, member)).status, 200);
  }
  const update = { tenantId, name: "Monthly expenses", dateMode: "PREVIOUS_MONTH_UTC", asOf: null, from: null, to: null, status: "POSTED", q: "", archived: false, expectedVersion: 1, requestId: randomUUID() };
  assert.equal((await call(path + "/" + id, "PATCH", { ...update, status: "ISSUED" }, member)).status, 400); assert.equal((await call(path + "/" + id, "PATCH", { ...update, dateMode: "TODAY_UTC", status: null }, member)).status, 400);
  const edits = await Promise.all([call(path + "/" + id, "PATCH", update, member), call(path + "/" + id, "PATCH", update, member)]); assert.ok(edits.every(result => result.status === 200), JSON.stringify(edits)); assert.deepEqual(edits.map(result => result.data.replayed).sort(), [false, true]);
  assert.equal((await call(path + "/" + id, "PATCH", { ...update, status: "DRAFT" }, member)).status, 409); assert.equal((await call(path + "/" + id, "PATCH", { ...update, requestId: randomUUID() }, member)).status, 409);
  const previousOpen = new URL((await open(id)).headers.get("location"), origin), previousEnd = new Date(day.slice(0, 7) + "-01T00:00:00Z"); previousEnd.setUTCDate(0);
  assert.equal(previousOpen.searchParams.get("to"), previousEnd.toISOString().slice(0, 10)); assert.equal(previousOpen.searchParams.get("from"), previousEnd.toISOString().slice(0, 7) + "-01");
  const archive = { ...update, archived: true, expectedVersion: 2, requestId: randomUUID() }; assert.equal((await call(path + "/" + id, "PATCH", archive, member)).status, 200); assert.equal((await open(id)).status, 409);
  assert.equal((await call(path, "POST", base, member)).data.preset.version, 3); assert.equal((await call(path + "/" + id, "PATCH", { ...archive, archived: false, expectedVersion: 3, requestId: randomUUID() }, member)).status, 200);
  assert.equal(await db.auditLog.count({ where: { entity: "SavedReport", entityId: id } }), 4);
  const row = await db.savedReport.findUnique({ where: { id } });
  for (const change of [{ status: "ISSUED" }, { from: new Date(day) }, { dateMode: "TODAY_UTC", status: null }, { kind: "INVOICE_REGISTER" }, { branchId: sibling.id }, { version: row.version + 2 }]) await assert.rejects(db.$transaction(async tx => {
   const requestId = randomUUID(), changed = await tx.savedReport.update({ where: { id }, data: { ...change, version: change.version ?? row.version + 1, lastRequestId: requestId } });
   const [clock] = await tx.$queryRaw`SELECT txid_current()::text AS transaction`;
   await tx.auditLog.create({ data: { tenantId, actorId: row.ownerId, entity: "SavedReport", entityId: id, action: "saved-report.updated", metadata: { version: changed.version, requestId, transaction: clock.transaction } } });
  }));
  await assert.rejects(db.savedReport.update({ where: { id }, data: { name: "Without audit", version: row.version + 1, lastRequestId: randomUUID() } })); await assert.rejects(db.savedReport.delete({ where: { id } }));
  // Persist old-format digests, then prove both pre-upgrade operations replay exactly.
  const ownerId = (await db.membership.findFirst({ where: { tenantId, user: { email: { startsWith: "register-" } }, roleGrants: { some: { role: { name: "Owner" } } } } })).userId;
  const legacy = { tenantId, companyId, branchId: null, kind: "CUSTOMER_BALANCES", name: "Legacy preset", dateMode: "TODAY_UTC", asOf: null, q: "", requestId: randomUUID() };
  const legacyUpdate = { tenantId, name: "Legacy modified", dateMode: "FIXED", asOf: day, q: "Old filters", archived: false, expectedVersion: 1, requestId: randomUUID() };
  await db.$transaction(async tx => {
   const [clock] = await tx.$queryRaw`SELECT txid_current()::text AS transaction`, digest = hash(legacy);
   await tx.savedReport.create({ data: { id: legacy.requestId, tenantId, companyId, branchId: null, ownerId, kind: legacy.kind, name: legacy.name, dateMode: legacy.dateMode, q: "", creationDigest: digest, lastRequestId: legacy.requestId, lastRequestDigest: digest } });
   await tx.auditLog.create({ data: { tenantId, actorId: ownerId, entity: "SavedReport", entityId: legacy.requestId, action: "saved-report.created", metadata: { version: 1, requestId: legacy.requestId, transaction: clock.transaction } } });
   await tx.savedReport.update({ where: { id: legacy.requestId }, data: { name: legacyUpdate.name, dateMode: legacyUpdate.dateMode, asOf: new Date(day), q: legacyUpdate.q, version: 2, lastRequestId: legacyUpdate.requestId, lastRequestDigest: hash({ id: legacy.requestId, ...legacyUpdate }) } });
   await tx.auditLog.create({ data: { tenantId, actorId: ownerId, entity: "SavedReport", entityId: legacy.requestId, action: "saved-report.updated", metadata: { version: 2, requestId: legacyUpdate.requestId, transaction: clock.transaction } } });
  });
  const legacyCreateReplay = await call(path, "POST", legacy, cookie), legacyUpdateReplay = await call(path + "/" + legacy.requestId, "PATCH", legacyUpdate, cookie);
  assert.equal(legacyCreateReplay.status, 201); assert.equal(legacyCreateReplay.data.replayed, true); assert.equal(legacyCreateReplay.data.preset.version, 2);
  assert.equal(legacyUpdateReplay.status, 200); assert.equal(legacyUpdateReplay.data.replayed, true); assert.equal(await db.auditLog.count({ where: { entity: "SavedReport", entityId: legacy.requestId } }), 2);
  // Per-type revocation leaves unrelated readable registers and their private presets available.
  await db.rolePermission.delete({ where: { tenantId_roleId_permissionKey: { tenantId, roleId: role.id, permissionKey: "invoice:read" } } });
  assert.equal((await open(ids.INVOICE_REGISTER)).status, 403); assert.equal((await open(id)).status, 303); assert.ok((await call(listPath, "GET", undefined, member)).data.presets.every(preset => preset.kind !== "INVOICE_REGISTER"));
  await db.rolePermission.delete({ where: { tenantId_roleId_permissionKey: { tenantId, roleId: role.id, permissionKey: "expense:read" } } });
  assert.equal((await open(id)).status, 403); assert.equal((await call(path, "POST", base, member)).status, 403); assert.equal((await call(path + "/" + id, "PATCH", { ...update, expectedVersion: 4, requestId: randomUUID() }, member)).status, 403);
  assert.doesNotMatch(await page(target), /name="from"/); assert.match(await page(seed), /Saved report filters unavailable/); assert.equal((await call("/api/expenses/report?" + reportQuery, "GET", undefined, member)).status, 403);
  assert.equal(await db.journalEntry.count({ where: { companyId } }), 0);
 } finally { server.kill("SIGTERM"); await db.$disconnect(); }
});
