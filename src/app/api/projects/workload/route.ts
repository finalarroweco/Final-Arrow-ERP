import { apiJson } from "@/lib/api-response";
import { currentUser } from "@/lib/auth";
import { queryInput } from "@/lib/ledger";
import { OperationalError } from "@/lib/operational-records";
import { projectWorkload, workloadCsv } from "@/lib/project-workload";
export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return apiJson({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const keys = ["tenantId", "companyId", "branchId", "asOf", "from", "to", "projectStatus", "q", "format"];
  const query = queryInput(params, keys);
  try {
    if (!query || [...params.keys()].some(key => !keys.includes(key))) throw new OperationalError("Invalid filters", 400);
    const { format = "json", ...filters } = query;
    if (format !== "json" && format !== "csv") throw new OperationalError("Invalid report format", 400);
    const report = await projectWorkload(actor.id, filters);
    if (format === "json") return apiJson(report, { headers: { "Cache-Control": "private, no-store" } });
    return new Response(workloadCsv(report), { headers: { "Cache-Control": "private, no-store",
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="project-workload.csv"' } });
  } catch (error) {
    if (error instanceof OperationalError) return apiJson({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    throw error;
  }
}
