import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { dueDate } from "@/lib/date";
import { queryInput } from "@/lib/ledger";
import { auditFilters, auditFilterKeys, auditRows } from "@/lib/audit-report";

const schema = z.object({ ...auditFilters, from: dueDate, to: dueDate, format: z.enum(["json", "csv"]).default("json") })
  .refine(({ from, to }) => to >= from && (Date.parse(to) - Date.parse(from)) / 86400000 < 366);
const cell = (value: string) => `"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(queryInput(new URL(request.url).searchParams, [...auditFilterKeys, "format"]));
  if (!parsed.success) return NextResponse.json({ error: "Invalid audit report filters (maximum 366 days)" }, { status: 400 });
  const { tenantId, from, to, timeZone, format } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, permission: "user:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await auditRows(parsed.data, 5001);
  if (entries.length > 5000) return NextResponse.json({ error: "Report exceeds 5000 events. Narrow the filters." }, { status: 413 });
  const actions = new Map<string, number>();
  const entities = new Map<string, number>();
  const actors = new Map<string, { actorId: string | null; actorName: string | null; count: number }>();
  const offset = timeZone === "Asia/Muscat" ? 14400000 : 0;
  const rows = entries.map(entry => ({ ...entry, timestamp: new Date(entry.createdAt.getTime() + offset).toISOString().replace("T", " ").slice(0, 19) }));
  for (const entry of entries) {
    actions.set(entry.action, (actions.get(entry.action) ?? 0) + 1);
    entities.set(entry.entity, (entities.get(entry.entity) ?? 0) + 1);
    const key = entry.actorId ?? "SYSTEM";
    const group = actors.get(key) ?? { actorId: entry.actorId, actorName: entry.actorName, count: 0 };
    group.count++; actors.set(key, group);
  }
  const summary = { events: entries.length, userEvents: entries.filter(entry => entry.actorId !== null).length,
    systemEvents: entries.filter(entry => entry.actorId === null).length,
    actions: [...actions].map(([action, count]) => ({ action, count })),
    entities: [...entities].map(([entity, count]) => ({ entity, count })), actors: [...actors.values()] };
  if (format === "json") return NextResponse.json({ from, to, timeZone, rows, summary }, { headers: { "Cache-Control": "private, no-store" } });
  const content = [["Organization ID", "From", "To", "Time zone", "Event ID", "Timestamp", "Action", "Record type", "Record ID", "Actor ID", "Current actor name"],
    ...rows.map(row => [tenantId, from, to, timeZone, row.id, row.timestamp, row.action, row.entity, row.entityId ?? "", row.actorId ?? "", row.actorName ?? (row.actorId ? "Former or unavailable user" : "System")])]
    .map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
  return new Response(`\uFEFF${content}`, { headers: { "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="audit-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store" } });
}
