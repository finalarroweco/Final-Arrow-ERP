import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { authorizeImport, commitImport, importHistory, importScope, previewImport } from "@/lib/catalog-imports";
import { operationalFailure } from "@/lib/operational-records";
const payload = importScope.extend({ csv: z.string().max(350000), mode: z.enum(["preview", "commit"]), requestId: z.string().uuid().optional(), previewDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() });
export async function POST(request: Request) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 // Bound JSON input before parsing; file bytes are additionally checked in the UI.
 const text = await request.text(); if (text.length > 2200000) return NextResponse.json({ error: "File too large" }, { status: 400 });
 const parsed = payload.safeParse((() => { try { return JSON.parse(text); } catch { return null; } })());
 if (!parsed.success) return NextResponse.json({ error: "Invalid import request" }, { status: 400 });
 const { csv, mode, requestId, previewDigest, ...scope } = parsed.data;
 try {
  await authorizeImport(scope, actor.id);
  if (mode === "preview") return NextResponse.json(await previewImport(scope, csv));
  if (!requestId || !previewDigest) return NextResponse.json({ error: "Preview and request ID required" }, { status: 400 });
  return NextResponse.json(await commitImport(scope, actor.id, csv, requestId, previewDigest), { status: 201 });
 } catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
export async function GET(request: Request) {
 const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
 const params = new URL(request.url).searchParams;
 if ([...params.keys()].some(key => !["tenantId", "companyId", "branchId", "kind", "page"].includes(key) || params.getAll(key).length !== 1)) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
 const parsed = importScope.safeParse({ tenantId: params.get("tenantId"), companyId: params.get("companyId"), branchId: params.get("branchId"), kind: params.get("kind") });
 const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get("page") ?? "0");
 if (!parsed.success || !page.success) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
 try { await authorizeImport(parsed.data, actor.id); return NextResponse.json(await importHistory(parsed.data, page.data)); }
 catch (error) { const failure = operationalFailure(error); return NextResponse.json({ error: failure.error }, { status: failure.status }); }
}
