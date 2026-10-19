"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string };
type Summary = { customers: number | null;
  leads: Record<string, number> | null; quotes: Record<string, number> | null;
  orders: Record<string, number> | null; projects: Record<string, number> | null;
  employees: number | null; tickets: Record<string, number> | null;
  expenses: { currency: string; postedCount: number; postedAmount: string } | null };

export function DashboardWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);
  const load = useCallback(async (index: number) => {
    const scope = options[index];
    if (!scope) return;
    const currentRequest = ++requestNumber.current;
    setSummary(null); setError("");
    try {
      const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId });
      const response = await fetch(`/api/dashboard?${query}`);
      const data = await response.json();
      if (currentRequest !== requestNumber.current) return;
      if (!response.ok) {
        setError(data.error ?? t("Could not load dashboard", "تعذر تحميل لوحة المعلومات"));
        return;
      }
      setSummary(data);
    } catch {
      if (currentRequest !== requestNumber.current) return;
      setError(t("Could not load activity. Check your connection and refresh.",
        "تعذر تحميل النشاط. تحقق من اتصالك واضغط تحديث."));
    }
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  if (!options.length) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  return <section><label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
    {options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {!summary && !error && <p>{t("Loading activity…", "جاري تحميل النشاط…")}</p>}
    {summary && <div className="dashboard-grid">
      {summary.customers !== null && <article><small>CRM</small><h2>{summary.customers}</h2><p>{t("Active customers", "العملاء النشطون")}</p><a href="/crm">{t("Open customers", "عرض العملاء")}</a></article>}
      {summary.leads && <article><small>{t("PIPELINE", "الفرص")}</small><h2>{summary.leads.NEW + summary.leads.QUALIFIED + summary.leads.PROPOSAL}</h2>
        <p>{t("Open leads", "الفرص المفتوحة")} · {summary.leads.WON} {t("won", "مكتسبة")} · {summary.leads.LOST} {t("lost", "مفقودة")}</p><a href="/crm/leads">{t("Open leads", "عرض العملاء المحتملين")}</a></article>}
      {summary.quotes && <article><small>{t("SALES", "المبيعات")}</small><h2>{summary.quotes.DRAFT + summary.quotes.SENT}</h2>
        <p>{t("Active quotes", "عروض نشطة")} · {summary.quotes.ACCEPTED} {t("accepted", "مقبولة")} · {summary.quotes.REJECTED} {t("rejected", "مرفوضة")}</p><a href="/sales/quotes">{t("Open quotes", "عرض عروض الأسعار")}</a></article>}
      {summary.orders && <article><small>{t("OPERATIONS", "العمليات")}</small><h2>{summary.orders.NEW + summary.orders.IN_PROGRESS}</h2>
        <p>{t("Open orders", "طلبات مفتوحة")} · {summary.orders.COMPLETED} {t("completed", "مكتملة")} · {summary.orders.CANCELLED} {t("cancelled", "ملغاة")}</p><a href="/sales/orders">{t("Open orders", "عرض الطلبات")}</a></article>}
      {summary.projects && <article><small>{t("PROJECTS", "المشاريع")}</small><h2>{summary.projects.PLANNED + summary.projects.ACTIVE + summary.projects.ON_HOLD}</h2>
        <p>{t("Open projects", "مشاريع مفتوحة")} · {summary.projects.COMPLETED} {t("completed", "مكتملة")}</p><a href="/projects">{t("Open projects", "عرض المشاريع")}</a></article>}
      {summary.tickets && <article><small>{t("HELPDESK", "الدعم الفني")}</small><h2>{summary.tickets.OPEN + summary.tickets.IN_PROGRESS}</h2>
        <p>{t("Active tickets", "تذاكر نشطة")} · {summary.tickets.RESOLVED} {t("resolved", "محلولة")}</p><a href="/helpdesk">{t("Open tickets", "عرض التذاكر")}</a></article>}
      {summary.employees !== null && <article><small>{t("HUMAN RESOURCES", "الموارد البشرية")}</small><h2>{summary.employees}</h2>
        <p>{t("Active employees", "الموظفون النشطون")}</p><a href="/hr/employees">{t("Open employees", "عرض الموظفين")}</a></article>}
      {summary.expenses && <article><small>{t("ACCOUNTING", "المحاسبة")}</small><h2>{summary.expenses.postedAmount} {summary.expenses.currency}</h2>
        <p>{t("Posted expense cost", "تكلفة المصاريف المرحّلة")} · {summary.expenses.postedCount} {t("records", "سجلات")}</p><a href="/accounting/expenses">{t("Open expenses", "عرض المصاريف")}</a></article>}
    </div>}
    <button onClick={() => void load(selected)}>{t("Refresh", "تحديث")}</button>
  </section>;
}
