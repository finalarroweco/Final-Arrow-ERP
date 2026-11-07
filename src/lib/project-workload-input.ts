import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const day = new Date(`${value}T00:00:00Z`);
  return value >= "2000-01-01" && value <= "2099-12-31" &&
    !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
});
export const workloadInput = z.object({
  tenantId: z.string().uuid(), companyId: z.string().uuid(), branchId: z.string().uuid().optional(),
  asOf: date, from: date, to: date,
  projectStatus: z.enum(["ALL", "OPEN", "PLANNED", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"]).default("OPEN"),
  q: z.string().trim().max(120).refine(value => !/[\u0000-\u001f]/u.test(value)).default(""),
}).strict().refine(value => value.to >= value.from &&
  (Date.parse(value.to) - Date.parse(value.from)) / 86400000 < 366,
{ message: "Invalid date range (maximum 366 days)" });
export type WorkloadInput = z.infer<typeof workloadInput>;
export type WorkloadPerson = { id: string; name: string; code: string; status: string };
export type WorkloadProject = { id: string; code: string; name: string; status: string; branchId: string | null };
export type WorkloadTask = { id: string; title: string; status: string; dueDate: string | null;
  employee: WorkloadPerson | null; project: WorkloadProject };
export type WorkloadTime = { id: string; date: string; minutes: number; reviewState: string;
  employee: WorkloadPerson; project: WorkloadProject };
export function taskDueBucket(due: string | null, asOf: string) {
  if (!due) return "UNDATED" as const;
  if (due < asOf) return "OVERDUE" as const;
  const nearEnd = new Date(Date.parse(asOf) + 3 * 86400000).toISOString().slice(0, 10);
  return due <= nearEnd ? "DUE_SOON" as const : "LATER" as const;
}
export function summarizeWorkload(tasks: WorkloadTask[], entries: WorkloadTime[], asOf: string) {
  const people = new Map<string, { employee: WorkloadPerson | null; tasks: number; inProgress: number;
    overdue: number; dueSoon: number; undated: number; later: number; entries: number;
    pendingMinutes: number; approvedMinutes: number; rejectedMinutes: number; totalMinutes: number; projects: Set<string> }>();
  function group(employee: WorkloadPerson | null) {
    const key = employee?.id ?? "UNASSIGNED";
    let row = people.get(key);
    if (!row) { row = { employee, tasks: 0, inProgress: 0, overdue: 0, dueSoon: 0, undated: 0, later: 0,
      entries: 0, pendingMinutes: 0, approvedMinutes: 0, rejectedMinutes: 0, totalMinutes: 0, projects: new Set() }; people.set(key, row); }
    return row;
  }
  for (const task of tasks) {
    const row = group(task.employee); row.tasks++; row.projects.add(task.project.id);
    if (task.status === "IN_PROGRESS") row.inProgress++;
    const bucket = taskDueBucket(task.dueDate, asOf);
    if (bucket === "OVERDUE") row.overdue++; else if (bucket === "DUE_SOON") row.dueSoon++;
    else if (bucket === "UNDATED") row.undated++; else row.later++;
  }
  for (const entry of entries) {
    const row = group(entry.employee); row.entries++; row.totalMinutes += entry.minutes; row.projects.add(entry.project.id);
    if (entry.reviewState === "APPROVED") row.approvedMinutes += entry.minutes;
    else if (entry.reviewState === "REJECTED") row.rejectedMinutes += entry.minutes;
    else row.pendingMinutes += entry.minutes;
  }
  const rows = [...people.values()].map(({ projects, ...row }) => ({ ...row, projects: projects.size }))
    .sort((a, b) => b.overdue - a.overdue || b.tasks - a.tasks ||
      (a.employee?.code ?? "").localeCompare(b.employee?.code ?? "") ||
      (a.employee?.id ?? "").localeCompare(b.employee?.id ?? ""));
  return { rows, totals: { tasks: tasks.length, entries: entries.length, employees: rows.filter(row => row.employee).length,
    unassigned: tasks.filter(task => !task.employee).length,
    overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
    dueSoon: rows.reduce((sum, row) => sum + row.dueSoon, 0),
    undated: rows.reduce((sum, row) => sum + row.undated, 0),
    totalMinutes: rows.reduce((sum, row) => sum + row.totalMinutes, 0),
    approvedMinutes: rows.reduce((sum, row) => sum + row.approvedMinutes, 0),
    pendingMinutes: rows.reduce((sum, row) => sum + row.pendingMinutes, 0),
    rejectedMinutes: rows.reduce((sum, row) => sum + row.rejectedMinutes, 0) } };
}
