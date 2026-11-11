import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportVisibilities } from "@/lib/saved-reports";
import { createReportInput, reportFields, reportKind, isRegisterReport } from "@/lib/report-presets";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { SavedReportsWorkspace, type ReportOption } from "./workspace";
const seedInput = z.object({ tenantId: z.string().uuid().optional(), companyId: z.string().uuid().optional(), kind: reportKind.optional(), branchId: z.string().uuid().optional(), dateMode: reportFields.dateMode.optional(), asOf: reportFields.asOf.optional(), from: reportFields.from, to: reportFields.to, status: reportFields.status, q: reportFields.q.optional() }).strict();
export default async function SavedReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const actor = await currentUser(); if (!actor) redirect("/login");
 const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
 const header = <header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/reports">{t("Report center", "مركز التقارير")}</a><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/accounting/customer-aging">{t("Customer aging", "أعمار العملاء")}</a><a href="/purchasing/supplier-aging">{t("Supplier aging", "أعمار الموردين")}</a></header>;
 const unavailable = () => <main>{header}<section className="panel"><h1>{t("Saved report filters unavailable", "فلاتر التقرير المحفوظ غير متاحة")}</h1><p role="alert">{t("The requested filters are invalid or no longer accessible. No other company, branch or report type has been selected.", "الفلاتر المطلوبة غير صالحة أو لم تعد متاحة بصلاحياتك. لم تُحدد شركة أو فرع أو نوع تقرير آخر بدلاً منها.")}</p><a href="/saved-reports">{t("Choose new filters", "اختيار فلاتر جديدة")}</a></section></main>;
 const parsed = seedInput.safeParse(await searchParams);
 if (!parsed.success || Boolean(parsed.data.tenantId) !== Boolean(parsed.data.companyId)) return unavailable();
 const seed = parsed.data;
 const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
 const options = (await Promise.all(memberships.flatMap(({ tenant }) => tenant.companies.map(async company => {
  const visibility = await reportVisibilities(actor.id, tenant.id, company.id);
  const kinds = reportKind.options.map(kind => { const visible = visibility[kind]; return visible === false ? null : { kind, branches: company.branches.filter(branch => visible === null || visible.includes(branch.id)).map(branch => ({ id: branch.id, name: branch.name })) }; }).filter(value => value !== null);
  return kinds.length ? { tenantId: tenant.id, companyId: company.id, label: tenant.name + " / " + company.name, kinds } satisfies ReportOption : null;
 })))).filter(value => value !== null);
 const companyIndex = seed.companyId ? options.findIndex(option => option.tenantId === seed.tenantId && option.companyId === seed.companyId) : 0;
 const option = options[companyIndex];
 if ((seed.companyId && !option) || (seed.kind && !option?.kinds.some(candidate => candidate.kind === seed.kind))) return unavailable();
 const kind = seed.kind ?? option?.kinds[0]?.kind ?? "CUSTOMER_BALANCES", branchId = seed.branchId ?? "";
 if (branchId && !option?.kinds.find(candidate => candidate.kind === kind)?.branches.some(branch => branch.id === branchId)) return unavailable();
 const register = isRegisterReport(kind), today = new Date().toISOString().slice(0, 10);
 const dateMode = seed.dateMode ?? (register ? seed.from || seed.to ? "FIXED_RANGE" : "CURRENT_MONTH_UTC" : seed.asOf ? "FIXED" : "TODAY_UTC");
 if (option && !createReportInput.safeParse({ tenantId: option.tenantId, companyId: option.companyId, branchId: branchId || null, kind, name: "Seed validation", requestId: actor.id, dateMode, asOf: seed.asOf ?? null, from: seed.from, to: seed.to, status: seed.status, q: seed.q ?? "" }).success) return unavailable();
 const initial = { companyIndex, kind, branchId, dateMode, asOf: seed.asOf ?? today, from: seed.from ?? today.slice(0, 7) + "-01", to: seed.to ?? today, status: seed.status ?? "", q: seed.q ?? "" };
 return <main>{header}
 <section className="hero"><p>{t("MY REPORTS", "تقاريري")}</p><h1>{t("Your report filters, ready to reuse.", "فلاتر تقاريرك جاهزة للاستخدام.")}</h1><p className="sub">{t("Save private presets for customer and supplier balances, aging, invoices, expenses, quotes and sales or purchase orders. Every opening runs the current report using your current permissions.", "احفظ إعداداتك الخاصة للأرصدة والأعمار والفواتير والمصاريف وعروض الأسعار وطلبات البيع والشراء. عند كل فتح يُحسب التقرير الحالي بصلاحياتك الحالية.")}</p></section>
 <SavedReportsWorkspace key={JSON.stringify(initial)} options={options} actorId={actor.id} locale={locale} initial={initial} /></main>;
}
