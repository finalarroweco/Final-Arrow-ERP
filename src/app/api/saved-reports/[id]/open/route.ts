import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { reportDateMode, reportKind, reportTarget } from "@/lib/report-presets";
import { ownedSavedReport, publicReport } from "@/lib/saved-reports";
import { OperationalError, operationalFailure } from "@/lib/operational-records";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const { id } = await params, search = new URL(request.url).searchParams;
 if (!z.string().uuid().safeParse(id).success || search.getAll("tenantId").length !== 1 || [...search.keys()].some(key => key !== "tenantId") || !z.string().uuid().safeParse(search.get("tenantId")).success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
 try {
  const preset = publicReport(await ownedSavedReport(actor.id, search.get("tenantId")!, id));
  if (preset.archivedAt) throw new OperationalError("Restore this saved report before opening it", 409);
  const target = reportTarget({ ...preset, kind: reportKind.parse(preset.kind), dateMode: reportDateMode.parse(preset.dateMode) });
  return new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "private, no-store" } });
 } catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
