import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportVisibility } from "@/lib/saved-reports";
import { reportKind, reportDate, reportDateMode } from "@/lib/report-presets";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { SavedReportsWorkspace, type ReportOption } from "./workspace";
export default async function SavedReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const actor = await currentUser(); if (!actor) redirect("/login");
 const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
 const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
 const options = (await Promise.all(memberships.flatMap(({ tenant }) => tenant.companies.map(async company => {
  const kinds = (await Promise.all(reportKind.options.map(async kind => { const visible = await reportVisibility(actor.id, tenant.id, company.id, kind); return visible === false ? null : { kind, branches: company.branches.filter(branch => visible === null || visible.includes(branch.id)).map(branch => ({ id: branch.id, name: branch.name })) }; }))).filter(value => value !== null);
  return kinds.length ? { tenantId: tenant.id, companyId: company.id, label: tenant.name + " / " + company.name, kinds } satisfies ReportOption : null;
 })))).filter(value => value !== null);
 const params = await searchParams, value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
 const companyIndex = Math.max(0, options.findIndex(option => option.tenantId === value("tenantId") && option.companyId === value("companyId")));
 const option = options[companyIndex], requested = reportKind.safeParse(value("kind")), kind = option?.kinds.find(candidate => requested.success && candidate.kind === requested.data)?.kind ?? option?.kinds[0]?.kind ?? "CUSTOMER_BALANCES";
 const branchId = option?.kinds.find(candidate => candidate.kind === kind)?.branches.some(branch => branch.id === value("branchId")) ? value("branchId") : "";
 const date = reportDate.safeParse(value("asOf")), mode = reportDateMode.safeParse(value("dateMode"));
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/accounting/customer-aging">{t("Customer aging", "أعمار العملاء")}</a><a href="/purchasing/supplier-aging">{t("Supplier aging", "أعمار الموردين")}</a></header>
 <section className="hero"><p>{t("MY REPORTS", "تقاريري")}</p><h1>{t("Your report filters, ready to reuse.", "فلاتر تقاريرك جاهزة للاستخدام.")}</h1><p className="sub">{t("Save private presets for customer and supplier balances and posting-date aging. Every opening runs the current report using your current permissions.", "احفظ إعداداتك الخاصة لأرصدة وأعمار العملاء والموردين من تاريخ القيد. عند كل فتح يُحسب التقرير الحالي بصلاحياتك الحالية.")}</p></section>
 <SavedReportsWorkspace options={options} actorId={actor.id} locale={locale} initial={{ companyIndex, kind, branchId, dateMode: mode.success ? mode.data : date.success ? "FIXED" : "TODAY_UTC", asOf: date.success ? date.data : new Date().toISOString().slice(0, 10), q: value("q").slice(0, 120) }} /></main>;
}
