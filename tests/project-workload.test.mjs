import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
const origin = "http://127.0.0.1:3244";
async function call(path, method = "GET", body, cookie) {
  const response = await fetch(origin + path, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
test("cross-project workload intersects task, time and employee scopes and exports full current activity", { timeout: 90000 }, async () => {
  const db = new PrismaClient(), server = spawn("./node_modules/.bin/next", ["start", "-H", "127.0.0.1", "-p", "3244"], { env: { ...process.env, ALLOW_REGISTRATION: "true" }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
    assert.ok(ready);
    async function owner() { const suffix = randomUUID().slice(0, 8); const result = await call("/api/auth/register", "POST", { name: "Workload owner", email: `workload-${suffix}@example.invalid`, password: "Workload-password-2026", organization: "Workload QA", slug: `workload-${suffix}` }); assert.equal(result.status, 201); return result; }
    const actor = await owner(), outsider = await owner(), tenantId = actor.data.tenantId, cookie = actor.cookie;
    const create = async (path, data) => { const result = await call(path, "POST", { tenantId, ...data }, cookie); assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data; };
    const { company } = await create("/api/companies", { name: "=Workload company", code: "WORK", baseCurrency: "OMR" }), companyId = company.id;
    const { company: foreignCompany } = await create("/api/companies", { name: "Other company", code: "OTHER", baseCurrency: "OMR" });
    const { branch } = await create("/api/branches", { companyId, name: "Main", code: "MAIN" }), { branch: sibling } = await create("/api/branches", { companyId, name: "Other", code: "OTHER" });
    const { employee } = await create("/api/employees", { companyId, branchId: branch.id, code: "EMP", fullName: "=Visible employee" });
    const { employee: hidden } = await create("/api/employees", { companyId, branchId: sibling.id, code: "HIDDEN", fullName: "Hidden sibling employee" });
    const { employee: idle } = await create("/api/employees", { companyId, branchId: branch.id, code: "IDLE", fullName: "Idle employee" });
    const makeProject = async (code, branchId) => { const { project } = await create("/api/projects", { companyId, ...(branchId ? { branchId } : {}), code, name: `=Project ${code}` }); assert.equal((await call(`/api/projects/${project.id}`, "PATCH", { tenantId, action: "activate" }, cookie)).status, 200); return project; };
    const main = await makeProject("MAIN", branch.id), second = await makeProject("SECOND", branch.id), other = await makeProject("HIDDEN", sibling.id), wide = await makeProject("WIDE");
    const task = async (project, title, employeeId, dueDate) => (await create(`/api/projects/${project.id}/tasks`, { title, ...(employeeId ? { assigneeEmployeeId: employeeId } : {}), ...(dueDate ? { dueDate } : {}) })).task;
    const a = await task(main, "=Overdue main", employee.id, "2026-10-31"), b = await task(second, "Due today", employee.id, "2026-11-01");
    await task(main, "Unassigned", null); await task(other, "Hidden task title", hidden.id, "2026-10-01");
    await task(wide, "Wide visible", employee.id); await task(wide, "Hidden wide task", hidden.id);
    const done = await task(main, "Completed task", employee.id);
    for (const action of ["start", "complete"]) assert.equal((await call(`/api/projects/${main.id}/tasks/${done.id}`, "PATCH", { tenantId, action }, cookie)).status, 200);
    assert.equal((await call(`/api/projects/${second.id}/tasks/${b.id}`, "PATCH", { tenantId, action: "start" }, cookie)).status, 200);
    const time = async (project, employeeId, minutes, workDate = "2026-11-01") => (await create(`/api/projects/${project.id}/time`, { employeeId, workDate, minutes, description: "Recorded work" })).entry;
    const approved = await time(main, employee.id, 90), pending = await time(second, employee.id, 30), rejected = await time(wide, employee.id, 15);
    await time(other, hidden.id, 600); await time(wide, hidden.id, 300); await time(main, employee.id, 120, "2026-10-31");
    const voided = await time(main, employee.id, 1440);
    assert.equal((await call(`/api/projects/${main.id}/time`, "PATCH", { tenantId, entryId: voided.id, reason: "Fixture correction" }, cookie)).status, 200);
    for (const [project, entry, state] of [[main, approved, "APPROVED"], [wide, rejected, "REJECTED"]]) assert.equal((await call(`/api/projects/${project.id}/time/reviews`, "POST", { tenantId, entryId: entry.id, expectedSequence: 0, requestId: randomUUID(), state, reason: "Fixture review" }, cookie)).status, 201);
    const permissions = ["project:read", "project-task:read", "project-time:read", "employee:read"];
    const { role } = await create("/api/roles", { name: "Workload reader", permissions });
    async function invite(roleId, scope, email = `workload-reader-${randomUUID().slice(0, 8)}@example.invalid`, existingCookie) {
      const invitation = await create("/api/invitations", { email, roleId, scope });
      const result = await call("/api/invitations/accept", "POST", { token: invitation.path.split("/").at(-1), ...(!existingCookie ? { name: "Workload reader", password: "Workload-reader-2026" } : {}) }, existingCookie);
      assert.equal(result.status, 200, JSON.stringify(result.data)); return result.cookie ?? existingCookie;
    }
    const reader = await invite(role.id, { type: "BRANCH", companyId, branchId: branch.id });
    const query = new URLSearchParams({ tenantId, companyId, from: "2026-11-01", to: "2026-11-01", asOf: "2026-11-01" });
    const path = "/api/projects/workload?" + query;
    assert.equal((await call(path)).status, 401); assert.equal((await call(path, "GET", undefined, outsider.cookie)).status, 403);
    const report = await call(path, "GET", undefined, reader); assert.equal(report.status, 200, JSON.stringify(report.data));
    assert.equal(report.data.basis, "CURRENT_STATE"); assert.equal(report.data.totals.tasks, 3); assert.equal(report.data.totals.overdue, 1); assert.equal(report.data.totals.dueSoon, 1); assert.equal(report.data.totals.unassigned, 1); assert.equal(report.data.totals.totalMinutes, 120); assert.equal(report.data.totals.approvedMinutes, 90);
    assert.equal(report.data.rows.find(row => row.employee?.id === employee.id).projects, 2);
    const serialized = JSON.stringify(report.data); for (const text of [hidden.id, hidden.fullName, other.id, wide.id, idle.id, "Hidden task title", voided.id]) assert.ok(!serialized.includes(text), text);
    assert.equal((await call(path + `&branchId=${sibling.id}`, "GET", undefined, reader)).status, 403);
    assert.equal((await call(path.replace(companyId, foreignCompany.id), "GET", undefined, reader)).status, 403);
    for (const suffix of ["&asOf=2026-11-02", "&q=abc&q=def", "&format=pdf", "&sql=select", "&to=2027-12-31", "&from=2026-11-02"]) assert.equal((await call(path + suffix, "GET", undefined, reader)).status, 400, suffix);
    const empty = await call(path + "&q=NoSuchProject", "GET", undefined, reader); assert.equal(empty.data.totals.tasks, 0); assert.equal(empty.data.rows.length, 0);
    const csv = await fetch(origin + path + "&format=csv", { headers: { Cookie: reader } }); assert.equal(csv.status, 200); assert.equal(csv.headers.get("cache-control"), "private, no-store"); const csvText = await csv.text();
    for (const text of ["\"'=Workload company\"", "\"'=Visible employee\"", "\"'=Overdue main\"", "\"APPROVED\"", "CURRENT_STATE"]) assert.ok(csvText.includes(text), text);
    assert.ok(!csvText.includes(hidden.id));
    const { role: projectRole } = await create("/api/roles", { name: "Company projects", permissions: permissions.filter(key => key !== "employee:read") });
    const { role: employeeRole } = await create("/api/roles", { name: "Branch employee", permissions: ["employee:read"] });
    const scopedEmail = `workload-mixed-${randomUUID().slice(0, 8)}@example.invalid`;
    const mixed = await invite(projectRole.id, { type: "COMPANY", companyId }, scopedEmail);
    assert.equal((await call(path, "GET", undefined, mixed)).status, 403, "employee access is independently required");
    const mixedReader = await invite(employeeRole.id, { type: "BRANCH", companyId, branchId: branch.id }, scopedEmail, mixed);
    const mixedReport = await call(path, "GET", undefined, mixedReader); assert.equal(mixedReport.status, 200, JSON.stringify(mixedReport.data));
    assert.equal(mixedReport.data.totals.tasks, 4); assert.equal(mixedReport.data.totals.totalMinutes, 135); assert.equal(mixedReport.data.totals.rejectedMinutes, 15);
    for (const text of [hidden.id, hidden.fullName, "Hidden wide task", "Hidden task title"]) assert.ok(!JSON.stringify(mixedReport.data).includes(text), text);
    assert.equal((await call(`/api/employees/${employee.id}`, "PATCH", { tenantId, action: "status", status: "INACTIVE" }, cookie)).status, 200);
    assert.equal((await call(path, "GET", undefined, reader)).data.rows.find(row => row.employee?.id === employee.id).employee.status, "INACTIVE");
    assert.equal((await call(`/api/projects/${second.id}`, "PATCH", { tenantId, action: "cancel" }, cookie)).status, 200);
    assert.equal((await call(path, "GET", undefined, reader)).data.totals.totalMinutes, 90);
    assert.equal((await call(path + "&projectStatus=ALL", "GET", undefined, reader)).data.totals.totalMinutes, 120);
    const page = await fetch(origin + "/projects/workload?" + new URLSearchParams({ scope: tenantId + ":" + companyId, from: "2026-11-01", to: "2026-11-01", asOf: "2026-11-01" }), { headers: { Cookie: reader } }); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /Employee activity|نشاط الموظفين/); assert.ok(!html.includes(hidden.fullName));
    // Read-only reporting creates no audit, task, time or financial records.
    const before = await db.auditLog.count({ where: { tenantId } }); await call(path, "GET", undefined, reader); assert.equal(await db.auditLog.count({ where: { tenantId } }), before);
    // Long task history verifies summary independence from the displayed page and bounded exports.
    const user = (await db.project.findUnique({ where: { id: main.id } })).createdBy;
    await db.projectTask.createMany({ data: Array.from({ length: 53 }, (_, index) => ({ tenantId, companyId, projectId: main.id, title: `Long work ${index}`, createdBy: user })) });
    assert.equal((await call(path, "GET", undefined, reader)).data.totals.tasks, 55);
    const longCsv = await fetch(origin + path + "&format=csv", { headers: { Cookie: reader } }); assert.ok((await longCsv.text()).includes("Long work 52"));
    const secondPage = await fetch(origin + "/projects/workload?" + new URLSearchParams({ scope: tenantId + ":" + companyId, from: "2026-11-01", to: "2026-11-01", asOf: "2026-11-01", page: "1" }), { headers: { Cookie: reader } }); assert.equal(secondPage.status, 200); assert.match(await secondPage.text(), /Long work/);
    await db.projectTask.createMany({ data: Array.from({ length: 4946 }, (_, index) => ({ tenantId, companyId, projectId: main.id, title: `Bounded work ${index}`, createdBy: user })) });
    assert.equal((await call(path, "GET", undefined, reader)).status, 413);
    assert.equal((await call(path + "&q=SECOND&projectStatus=ALL", "GET", undefined, reader)).status, 200);
    for (const permissionKey of permissions) {
      await db.rolePermission.delete({ where: { tenantId_roleId_permissionKey: { tenantId, roleId: role.id, permissionKey } } });
      assert.equal((await call(path, "GET", undefined, reader)).status, 403, permissionKey);
      await db.rolePermission.create({ data: { tenantId, roleId: role.id, permissionKey } });
    }
  } finally { server.kill("SIGTERM"); await db.$disconnect(); }
});
