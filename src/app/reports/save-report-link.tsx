import { translate, type Locale } from "@/lib/locale";
import type { ReportKind } from "@/lib/report-presets";
export function SaveReportLink({ kind, tenantId, companyId, branchId, asOf, q, locale }: { kind: ReportKind; tenantId: string; companyId: string; branchId: string; asOf: string; q: string; locale: Locale }) {
 const query = new URLSearchParams({ kind, tenantId, companyId, dateMode: "FIXED", asOf, q, ...(branchId ? { branchId } : {}) });
 return <a href={"/saved-reports?" + query}>{translate(locale, "Save these filters", "حفظ هذه الفلاتر")}</a>;
}
