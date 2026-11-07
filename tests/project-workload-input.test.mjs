import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { workloadInput, taskDueBucket, summarizeWorkload } from "../src/lib/project-workload-input.ts";
test("workload dates are explicit valid calendar dates and bounded inclusive periods", () => {
  const filters = { tenantId: randomUUID(), companyId: randomUUID(), asOf: "2024-02-29", from: "2024-01-01", to: "2024-12-31" };
  assert.equal(workloadInput.safeParse(filters).success, true);
  for (const patch of [{ asOf: "2025-02-29" }, { asOf: "1999-12-31" }, { to: "2025-01-01" }, { from: "2025-01-01" }, { branchId: "" }, { projectStatus: "PAID" }, { q: "\0" }, { sql: "select" }])
    assert.equal(workloadInput.safeParse({ ...filters, ...patch }).success, false, JSON.stringify(patch));
  assert.equal(workloadInput.parse({ ...filters, q: "  المشروع  " }).q, "المشروع");
  for (const [day, bucket] of [[null, "UNDATED"], ["2024-02-28", "OVERDUE"], ["2024-02-29", "DUE_SOON"], ["2024-03-03", "DUE_SOON"], ["2024-03-04", "LATER"]])
    assert.equal(taskDueBucket(day, filters.asOf), bucket);
  assert.equal(taskDueBucket("2099-12-31", "2099-12-31"), "DUE_SOON");
});
test("workload keeps employees, unassigned work and review-state minutes distinct", () => {
  const employee = { id: "a", name: "Person", code: "A", status: "INACTIVE" }, other = { ...employee, id: "b", code: "B" };
  const project = { id: "p", code: "P", name: "Project", status: "ACTIVE", branchId: null };
  const task = { id: "1", title: "Work", status: "TODO", dueDate: null, employee, project };
  const entry = { id: "t", date: "2026-11-01", minutes: 60, reviewState: "PENDING", employee, project };
  const result = summarizeWorkload([task, { ...task, id: "2", employee: null, dueDate: "2026-10-31" },
    { ...task, id: "3", dueDate: "2026-11-04", status: "IN_PROGRESS" }], [entry, { ...entry, id: "u", minutes: 90, reviewState: "APPROVED" },
    { ...entry, id: "v", minutes: 15, reviewState: "REJECTED", employee: other }], "2026-11-01");
  assert.deepEqual(result.totals, { tasks: 3, entries: 3, employees: 2, unassigned: 1, overdue: 1, dueSoon: 1, undated: 1, totalMinutes: 165, approvedMinutes: 90, pendingMinutes: 60, rejectedMinutes: 15 });
  const person = result.rows.find(row => row.employee?.id === "a");
  assert.equal(person.projects, 1); assert.equal(person.tasks, 2); assert.equal(person.inProgress, 1); assert.equal(person.totalMinutes, 150);
  assert.equal(result.rows[0].employee, null, "overdue unassigned work is retained and sorted first");
  assert.equal(result.rows.find(row => row.employee?.id === "b").tasks, 0, "time-only employees remain visible");
  assert.deepEqual(summarizeWorkload([], [], "2026-11-01").rows, []);
});
