import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { ticketDeadlineReport } from "@/lib/ticket-deadlines";
import { deadlineReportCsv } from "@/lib/ticket-deadline-input";
import { operationalFailure } from "@/lib/operational-records";
export async function GET(request: Request) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const query = new URL(request.url).searchParams;
 if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return NextResponse.json({ error: "Duplicate report filter" }, { status: 400 });
 try { const report = await ticketDeadlineReport(actor.id, Object.fromEntries(query));
  if (report.format === "csv") return new Response("\uFEFF" + deadlineReportCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=ticket-deadlines.csv", "Cache-Control": "private, no-store" } });
  return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
 } catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
