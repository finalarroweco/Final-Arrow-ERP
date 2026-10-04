import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { queryInput } from "@/lib/ledger";
import { auditFilters, auditFilterKeys, auditRows } from "@/lib/audit-report";

const querySchema = z.object({ ...auditFilters, page: z.coerce.number().int().min(0).max(100000).default(0) })
  .refine(value => !value.from || !value.to || value.from <= value.to);
export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = querySchema.safeParse(queryInput(new URL(request.url).searchParams, [...auditFilterKeys, "page"]));
  if (!parsed.success) return NextResponse.json({ error: "Invalid or duplicate audit filters" }, { status: 400 });
  if (!(await canAccess({ userId: actor.id, tenantId: parsed.data.tenantId, permission: "user:manage" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const entries = await auditRows(parsed.data, 51, parsed.data.page * 50);
  return NextResponse.json({ entries: entries.slice(0, 50), timeZone: parsed.data.timeZone,
    nextPage: entries.length > 50 ? parsed.data.page + 1 : null }, { headers: { "Cache-Control": "private, no-store" } });
}
