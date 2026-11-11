import { apiJson } from "@/lib/api-response";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { deadlineChangeInput } from "@/lib/ticket-deadline-input";
import { changeTicketDeadline, ticketDeadlineDetails } from "@/lib/ticket-deadlines";
import { operationalFailure } from "@/lib/operational-records";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
 const actor = await currentUser(); if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
 const { id } = await params, query = new URL(request.url).searchParams;
 const parsed = z.object({ tenantId: z.string().uuid(), page: z.coerce.number().int().min(0).max(100000).default(0) }).strict().safeParse(Object.fromEntries(query));
 if (!parsed.success || [...query.keys()].some(key => query.getAll(key).length !== 1)) return apiJson({ error: "Invalid deadline filters" }, { status: 400 });
 try { return apiJson(await ticketDeadlineDetails(actor.id, parsed.data.tenantId, id, parsed.data.page), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { const failure = operationalFailure(error); return apiJson({ error: failure.error }, { status: failure.status }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
 const actor = await currentUser(); if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
 const { id } = await params, parsed = deadlineChangeInput.safeParse(await request.json().catch(() => null));
 if (!parsed.success) return apiJson({ error: "Invalid deadline change" }, { status: 400 });
 try { return apiJson(await changeTicketDeadline(actor.id, id, parsed.data), { status: 201, headers: { "Cache-Control": "private, no-store" } }); } catch (error) { const failure = operationalFailure(error); return apiJson({ error: failure.error }, { status: failure.status }); }
}
