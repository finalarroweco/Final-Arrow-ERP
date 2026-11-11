import { apiJson } from "@/lib/api-response";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { termTemplateRequest, termTemplateScope } from "@/lib/payment-term-template-input";
import { authorizeTermTemplates, saveTermTemplate, termTemplateFailure, termTemplateSelect } from "@/lib/payment-term-templates";
const filters = termTemplateScope.extend({ state: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
  page: z.coerce.number().int().min(0).max(1000).default(0) }).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401, headers });
  const params = new URL(request.url).searchParams, parsed = filters.safeParse(Object.fromEntries(params));
  if (!parsed.success || [...params.keys()].some(key => params.getAll(key).length !== 1)) return apiJson({ error: "Invalid template filters" }, { status: 400, headers });
  try {
    const { tenantId, companyId, page, state } = parsed.data;
    await authorizeTermTemplates(actor.id, tenantId, companyId);
    const rows = await db.paymentTermTemplate.findMany({ where: { tenantId, companyId,
      ...(state === "ALL" ? {} : { archivedAt: state === "ACTIVE" ? null : { not: null } }) },
      select: termTemplateSelect, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page * 50, take: 51 });
    return apiJson({ templates: rows.slice(0, 50), nextPage: rows.length > 50 ? page + 1 : null }, { headers });
  } catch (error) { const result = termTemplateFailure(error); return apiJson({ error: result.error }, { status: result.status, headers }); }
}
export async function POST(request: Request) {
  const actor = await currentUser(); if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401, headers });
  const parsed = termTemplateRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiJson({ error: "Invalid template request" }, { status: 400, headers });
  try { return apiJson(await saveTermTemplate(actor.id, parsed.data), { status: parsed.data.action === "create" ? 201 : 200, headers }); }
  catch (error) { const result = termTemplateFailure(error); return apiJson({ error: result.error }, { status: result.status, headers }); }
}
