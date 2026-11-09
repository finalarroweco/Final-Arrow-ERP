import { z } from "zod";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportVisibility } from "@/lib/saved-reports";
import { registerReportKind, registerTypes, registerStatuses, reportDate } from "@/lib/report-presets";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { FinancialReport } from "../../accounting/financial-report";

const filters = z.object({
  tenantId: z.string().uuid(), companyId: z.string().uuid(), kind: registerReportKind,
  from: reportDate, to: reportDate, branchId: z.string().uuid().optional(),
  status: z.string().min(1).optional(), q: z.string().trim().max(120).refine(value => !value.includes("\0")).default(""),
}).strict().refine(value => value.to >= value.from && (Date.parse(value.to) - Date.parse(value.from)) / 86400000 < 366)
  .refine(value => !value.status || (registerStatuses[value.kind] as readonly string[]).includes(value.status));

export default async function RegisterReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await currentUser();
  if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const header = <header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} />
    <a href="/reports">{t("Report center", "مركز التقارير")}</a><a href="/saved-reports">{t("My saved reports", "تقاريري المحفوظة")}</a><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a></header>;
  const unavailable = <main lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{header}<section className="panel">
    <h1>{t("Register report unavailable", "تقرير السجل غير متاح")}</h1>
    <p role="alert">{t("These filters are invalid or no longer accessible. Open an available saved report or choose filters in its register.", "هذه الفلاتر غير صالحة أو لم تعد متاحة بصلاحياتك الحالية. افتح تقريراً محفوظاً متاحاً أو اختر الفلاتر من سجله.")}</p>
  </section></main>;
  const parsed = filters.safeParse(await searchParams);
  if (!parsed.success) return unavailable;
  const { tenantId, companyId, kind, from, to, branchId, status, q } = parsed.data;
  const visible = await reportVisibility(actor.id, tenantId, companyId, kind);
  if (visible === false || (Array.isArray(visible) && !visible.length) || (branchId && visible !== null && !visible.includes(branchId))) return unavailable;
  const company = await db.company.findUnique({
    where: { tenantId_id: { tenantId, id: companyId } },
    select: { name: true, branches: { where: { tenantId, companyId, ...(visible === null ? {} : { id: { in: visible } }) }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  if (!company || (branchId && !company.branches.some(branch => branch.id === branchId))) return unavailable;
  return <main lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>{header}
    <section className="hero"><p>{t("DOCUMENT REGISTERS", "سجلات المستندات")}</p><h1>{company.name}</h1>
      <p className="sub">{t("Current records using your saved filters and current permissions.", "السجلات الحالية باستخدام فلاترك المحفوظة وصلاحياتك الحالية.")}</p></section>
    <FinancialReport kind={registerTypes[kind]} scope={{ tenantId, companyId, branches: company.branches }} locale={locale} initial={{ from, to, branchId, status, q }} />
  </main>;
}
