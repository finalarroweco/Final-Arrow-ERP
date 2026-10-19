import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createReportInput } from "@/lib/report-presets";
import { createSavedReport, listSavedReports } from "@/lib/saved-reports";
import { operationalFailure } from "@/lib/operational-records";
export async function POST(request: Request) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const parsed = createReportInput.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid saved report" }, { status: 400 });
 try { return NextResponse.json(await createSavedReport(actor.id, parsed.data), { status: 201, headers: { "Cache-Control": "private, no-store" } }); }
 catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
export async function GET(request: Request) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const params = new URL(request.url).searchParams;
 if ([...params.keys()].some(key => !["tenantId", "companyId", "archived", "page"].includes(key) || params.getAll(key).length !== 1)) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
 const parsed = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid(), archived: z.enum(["true", "false"]).default("false"), page: z.coerce.number().int().min(0).max(100000).default(0) }).safeParse(Object.fromEntries(params));
 if (!parsed.success) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
 try { return NextResponse.json(await listSavedReports(actor.id, parsed.data.tenantId, parsed.data.companyId, parsed.data.archived === "true", parsed.data.page), { headers: { "Cache-Control": "private, no-store" } }); }
 catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
