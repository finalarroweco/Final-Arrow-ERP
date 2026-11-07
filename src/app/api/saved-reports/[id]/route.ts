import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { updateReportInput } from "@/lib/report-presets";
import { updateSavedReport } from "@/lib/saved-reports";
import { operationalFailure } from "@/lib/operational-records";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const { id } = await params, parsed = updateReportInput.safeParse(await request.json().catch(() => null));
 if (!z.string().uuid().safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid saved report" }, { status: 400 });
 try { return NextResponse.json(await updateSavedReport(actor.id, id, parsed.data), { headers: { "Cache-Control": "private, no-store" } }); }
 catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
