import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";

const uuid = z.string().uuid();
const optionalId = uuid.optional();
const querySchema = z.object({ tenantId: uuid, companyId: uuid, from: dueDate, to: dueDate,
  branchId: optionalId, employeeId: optionalId, format: z.enum(["json", "csv"]).default("json") })
  .refine(({ from, to }) => to >= from &&
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 < 31);
const time = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
// Spreadsheet software can evaluate cells beginning with these characters as formulas.
const csvCell = (value: string) => {
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(["tenantId", "companyId", "from", "to", "branchId", "employeeId", "format"]
    .filter((key) => params.has(key)).map((key) => [key, params.get(key)])));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report scope or date range (maximum 31 days)" }, { status: 400 });
  const { tenantId, companyId, from, to, branchId, employeeId, format } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "attendance:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const records = await db.attendanceRecord.findMany({ where: { tenantId, companyId,
    workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    ...(branchId ? { branchId } : branches === null ? {} : { branchId: { in: branches } }),
    ...(employeeId ? { employeeId } : {}) },
    select: { workDate: true, branchId: true, employee: { select: { code: true, fullName: true } },
      startMinute: true, endMinute: true, note: true },
    orderBy: [{ workDate: "asc" }, { id: "asc" }], take: 5001 });
  if (records.length > 5000) return NextResponse.json({ error: "Report exceeds 5000 entries. Narrow the date or employee filter." }, { status: 413 });
  const branchIds = [...new Set(records.map((record) => record.branchId).filter((id): id is string => !!id))];
  const branchNames = new Map((await db.branch.findMany({ where: { tenantId, companyId, id: { in: branchIds } },
    select: { id: true, name: true } })).map((branch) => [branch.id, branch.name]));
  const rows = records.map((record) => ({ date: record.workDate.toISOString().slice(0, 10),
    employeeCode: record.employee.code, employeeName: record.employee.fullName,
    branch: record.branchId ? branchNames.get(record.branchId) ?? "" : "",
    start: time(record.startMinute), end: record.endMinute === null ? "" : time(record.endMinute),
    minutes: record.endMinute === null ? null : record.endMinute - record.startMinute,
    note: record.note ?? "" }));
  const summary = { entries: rows.length, open: rows.filter((row) => row.minutes === null).length,
    completedMinutes: rows.reduce((total, row) => total + (row.minutes ?? 0), 0) };
  if (format === "json") return NextResponse.json({ rows, summary });
  const header = ["Date", "Employee code", "Employee name", "Branch", "Start", "End", "Minutes", "Note"];
  const content = [header, ...rows.map((row) => [row.date, row.employeeCode, row.employeeName,
    row.branch, row.start, row.end, row.minutes === null ? "" : String(row.minutes), row.note])]
    .map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(`\uFEFF${content}`, { headers: { "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="attendance-${from}-to-${to}.csv"`,
    "Cache-Control": "private, no-store" } });
}
