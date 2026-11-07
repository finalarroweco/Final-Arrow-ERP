import { Prisma } from "@prisma/client";
import { db } from "./db";
import { readableCompanyPermissions } from "./access";
import { intersectBranches } from "./approval-scope";
import { OperationalError } from "./operational-records";
import { summarizeWorkload, taskDueBucket, workloadInput } from "./project-workload-input";

export async function workloadAccess(userId: string, tenantId: string, companyId: string) {
  const rights = await readableCompanyPermissions({ userId, tenantId, companyId,
    permissions: ["project:read", "project-task:read", "project-time:read", "employee:read"] });
  return { projects: intersectBranches(intersectBranches(rights["project:read"], rights["project-task:read"]), rights["project-time:read"]), employees: rights["employee:read"] };
}
export async function projectWorkload(userId: string, input: unknown) {
  const parsed = workloadInput.safeParse(input);
  if (!parsed.success) throw new OperationalError("Invalid workload filters (maximum 366 days)", 400);
  const filters = parsed.data;
  const access = await workloadAccess(userId, filters.tenantId, filters.companyId);
  if (access.projects === false || access.employees === false ||
    (filters.branchId && access.projects !== null && !access.projects.includes(filters.branchId)))
    throw new OperationalError("Forbidden", 403);
  const projectWhere: Prisma.ProjectWhereInput = { tenantId: filters.tenantId, companyId: filters.companyId,
    ...(filters.branchId ? { branchId: filters.branchId } : access.projects === null ? {} : { branchId: { in: access.projects } }),
    ...(filters.projectStatus === "ALL" ? {} : { status: filters.projectStatus === "OPEN" ?
      { in: ["PLANNED", "ACTIVE", "ON_HOLD"] } : filters.projectStatus }),
    ...(filters.q ? { OR: [{ code: { contains: filters.q, mode: "insensitive" } }, { name: { contains: filters.q, mode: "insensitive" } }] } : {}) };
  const employeeWhere: Prisma.EmployeeWhereInput = { tenantId: filters.tenantId, companyId: filters.companyId,
    ...(access.employees === null ? {} : { branchId: { in: access.employees } }) };
  const projectSelect = { id: true, code: true, name: true, status: true, branchId: true } as const;
  const personSelect = { id: true, fullName: true, code: true, status: true } as const;
  return db.$transaction(async tx => {
    const [company, clock, tasks, entries] = await Promise.all([
      tx.company.findUnique({ where: { tenantId_id: { tenantId: filters.tenantId, id: filters.companyId } }, select: { name: true, code: true } }),
      tx.$queryRaw<{ evaluatedAt: Date }[]>`SELECT CURRENT_TIMESTAMP AS "evaluatedAt"`,
      tx.projectTask.findMany({ where: { tenantId: filters.tenantId, companyId: filters.companyId,
        status: { in: ["TODO", "IN_PROGRESS"] }, project: projectWhere,
        OR: [{ assigneeEmployeeId: null }, { assignee: employeeWhere }] },
        select: { id: true, title: true, status: true, dueDate: true, project: { select: projectSelect }, assignee: { select: personSelect } },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }], take: 5001 }),
      tx.projectTimeEntry.findMany({ where: { tenantId: filters.tenantId, companyId: filters.companyId,
        voidedAt: null, project: projectWhere, employee: employeeWhere,
        workDate: { gte: new Date(`${filters.from}T00:00:00Z`), lte: new Date(`${filters.to}T00:00:00Z`) } },
        select: { id: true, workDate: true, minutes: true, reviewState: true,
          employee: { select: personSelect }, project: { select: projectSelect } },
        orderBy: [{ workDate: "asc" }, { id: "asc" }], take: 5001 }),
    ]);
    if (!company) throw new OperationalError("Company not found", 404);
    if (tasks.length > 5000 || entries.length > 5000)
      throw new OperationalError("Report exceeds 5000 tasks or time entries. Narrow branch, project or dates.", 413);
    const person = (value: { id: string; fullName: string; code: string; status: string }) =>
      ({ id: value.id, name: value.fullName, code: value.code, status: value.status });
    const taskRows = tasks.map(({ assignee, dueDate, ...task }) => ({ ...task, employee: assignee ? person(assignee) : null,
      dueDate: dueDate?.toISOString().slice(0, 10) ?? null,
      dueBucket: taskDueBucket(dueDate?.toISOString().slice(0, 10) ?? null, filters.asOf) }));
    const timeRows = entries.map(({ workDate, employee, ...entry }) => ({ ...entry, employee: person(employee), date: workDate.toISOString().slice(0, 10) }));
    return { filters, company, evaluatedAt: clock[0].evaluatedAt.toISOString(), basis: "CURRENT_STATE" as const,
      tasks: taskRows, entries: timeRows, ...summarizeWorkload(taskRows, timeRows, filters.asOf) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

const cell = (value: string | number | null) => `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(String(value ?? "")) ? "'" : "") + String(value ?? "").replaceAll('"', '""')}"`;
export function workloadCsv(report: Awaited<ReturnType<typeof projectWorkload>>) {
  const f = report.filters;
  const prefix = [report.company.code, report.company.name, f.branchId ?? "", f.projectStatus, f.q, f.asOf, f.from, f.to, report.evaluatedAt, report.basis];
  const lines: (string | number | null)[][] = [["Company code", "Company name", "Project branch filter", "Current project status filter", "Project search", "Task due comparison date UTC", "Time from UTC", "Time to UTC", "Evaluated at UTC", "Basis", "Row type", "Employee ID", "Employee code", "Employee name", "Employee status", "Project ID", "Project code", "Project name", "Project status", "Project branch ID", "Source ID", "Task title", "Task status", "Due date UTC", "Due bucket", "Work date UTC", "Minutes", "Current review state"]];
  for (const task of report.tasks) lines.push([...prefix, "TASK", task.employee?.id ?? "", task.employee?.code ?? "", task.employee?.name ?? "", task.employee?.status ?? "", task.project.id, task.project.code, task.project.name, task.project.status, task.project.branchId, task.id, task.title, task.status, task.dueDate, task.dueBucket, "", "", ""]);
  for (const entry of report.entries) lines.push([...prefix, "TIME", entry.employee.id, entry.employee.code, entry.employee.name, entry.employee.status, entry.project.id, entry.project.code, entry.project.name, entry.project.status, entry.project.branchId, entry.id, "", "", "", "", entry.date, entry.minutes, entry.reviewState]);
  // A scope row preserves the chosen filters even when no authorized activity matches.
  if (lines.length === 1) lines.push([...prefix, "EMPTY", ...Array(17).fill("")]);
  return "\uFEFF" + lines.map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
