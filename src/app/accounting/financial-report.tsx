"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { reportDate, registerStatuses, type RegisterReportKind } from "@/lib/report-presets";

type Group = { status: string; currency: string; category: string; count: number; amount: string };
type Result = { from: string; to: string; count: number; summary: Group[]; categories: Group[]; suppliers: (Group & { supplierId: string; supplierName: string })[] };
type Kind = "expenses" | "invoices" | "purchase-orders" | "quotes" | "orders";
type Filters = { from: string; to: string; branchId?: string; status?: string; q?: string };
type Props = { kind: Kind; scope: { tenantId: string; companyId: string; branches: { id: string; name: string }[] }; locale: Locale; initial?: Filters };
const presetKinds: Record<Kind, RegisterReportKind> = {
  expenses: "EXPENSE_REGISTER", invoices: "INVOICE_REGISTER", "purchase-orders": "PURCHASE_ORDER_REGISTER",
  quotes: "QUOTE_REGISTER", orders: "SALES_ORDER_REGISTER",
};
const labels: Record<string, string> = { DRAFT: "مسودة", POSTED: "مرحّل", ISSUED: "مصدرة", VOID: "ملغى", RECEIVED: "مستلم", CANCELLED: "ملغى", SENT: "مرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض", NEW: "جديد", IN_PROGRESS: "قيد التنفيذ", COMPLETED: "مكتمل" };

export function FinancialReport(props: Props) {
  const { kind, scope, locale, initial } = props;
  // A changed scope or preset gets fresh inputs and state before it can paint old results.
  const key = JSON.stringify([kind, scope.tenantId, scope.companyId, scope.branches.map(branch => branch.id), locale,
    initial ? [initial.from, initial.to, initial.branchId ?? "", initial.status ?? "", initial.q ?? ""] : null]);
  return <FinancialReportView key={key} {...props} />;
}

function FinancialReportView({ kind, scope, locale, initial }: Props) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [successful, setSuccessful] = useState<{ result: Result; query: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openingFilters] = useState(initial);
  const [filters, setFilters] = useState(() => ({ from: initial?.from ?? "", to: initial?.to ?? "", branchId: initial?.branchId ?? "", status: initial?.status ?? "", q: initial?.q ?? "" }));
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const branchIds = JSON.stringify(scope.branches.map(branch => branch.id));
  const statuses: readonly string[] = registerStatuses[presetKinds[kind]];

  const load = useCallback(async (filters: Filters) => {
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    setSuccessful(null);
    setError("");
    setBusy(false);
    const q = (filters.q ?? "").trim(), branchId = filters.branchId ?? "", status = filters.status ?? "";
    if (!reportDate.safeParse(filters.from).success || !reportDate.safeParse(filters.to).success ||
      filters.to < filters.from || (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000 >= 366 ||
      q.length > 120 || q.includes("\0") ||
      (branchId && !(JSON.parse(branchIds) as string[]).includes(branchId)) ||
      (status && !(registerStatuses[presetKinds[kind]] as readonly string[]).includes(status))) {
      setError(translate(locale, "Invalid report filters (maximum 366 days).", "فلاتر التقرير غير صالحة (حتى 366 يوماً)."));
      return;
    }
    const params = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, from: filters.from, to: filters.to });
    if (branchId) params.set("branchId", branchId);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const controller = new AbortController();
    request.current.controller = controller;
    setBusy(true);
    const current = () => request.current.generation === generation && !controller.signal.aborted;
    try {
      const response = await fetch(`/api/${kind}/report?${params}`, { signal: controller.signal, cache: "no-store" });
      const data = await response.json();
      if (!current()) return;
      if (response.ok) setSuccessful({ result: data, query: params.toString() });
      else setError(typeof data.error === "string" ? data.error : translate(locale, "Unable to load report.", "تعذّر تحميل التقرير."));
    } catch {
      if (current()) setError(translate(locale, "Network request failed", "فشل الاتصال بالشبكة"));
    } finally {
      if (current()) setBusy(false);
    }
  }, [kind, scope.tenantId, scope.companyId, branchIds, locale]);

  useEffect(() => {
    const activeRequest = request.current;
    if (openingFilters) void load(openingFilters);
    return () => {
      ++activeRequest.generation;
      activeRequest.controller?.abort();
    };
  }, [openingFilters, load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await load(filters);
  }
  function update(field: keyof Filters, value: string) {
    setFilters(current => ({ ...current, [field]: value }));
  }
  const result = successful?.result;
  const saveParams = successful ? new URLSearchParams(successful.query) : null;
  if (saveParams) {
    saveParams.set("kind", presetKinds[kind]);
    saveParams.set("dateMode", "FIXED_RANGE");
    if (!saveParams.has("q")) saveParams.set("q", "");
  }
  return <section className="panel"><h2>{t(kind === "expenses" ? "Expense report" : kind === "purchase-orders" ? "Purchase order report" : kind === "quotes" ? "Quote register report" : kind === "orders" ? "Sales order report" : "Invoice register report", kind === "expenses" ? "تقرير المصاريف" : kind === "purchase-orders" ? "تقرير أوامر الشراء" : kind === "quotes" ? "تقرير عروض الأسعار" : kind === "orders" ? "تقرير طلبات البيع" : "تقرير سجل الفواتير")}</h2>
    <p>{kind === "expenses" ? t("Uses expense dates. Totals show net expense plus non-deductible VAT; deductible VAT is excluded from cost. CSV separates net, tax and gross. Draft, posted and void stay separate; this register does not apply journal reversal effects.", "يعتمد تاريخ المصروف. تُجمع تكلفة المصروف الصافية والضريبة غير القابلة للخصم، وتُستثنى الضريبة القابلة للخصم من التكلفة. يفصل CSV الصافي والضريبة والإجمالي. الحالات منفصلة؛ لا يطبّق هذا السجل تأثير عكس القيود.") : kind === "purchase-orders" ? t("Uses creation dates in UTC and saved supplier names. Status totals are separate; this is not a payable or payment report.", "يعتمد تاريخ الإنشاء بتوقيت UTC واسم المورد المحفوظ. إجماليات الحالات منفصلة؛ لا يمثل الذمم أو المدفوعات.") : kind === "quotes" ? t("Uses creation dates in UTC and current customer names. This register does not represent revenue or collections.", "يعتمد تاريخ الإنشاء بتوقيت UTC وأسماء العملاء الحالية. هذا السجل لا يمثل الإيراد أو التحصيل.") : kind === "orders" ? t("Uses creation dates in UTC and saved customer names. Order totals do not represent recognized revenue or payments.", "يعتمد تاريخ الإنشاء بتوقيت UTC وأسماء العملاء المحفوظة. إجماليات الطلبات لا تمثل الإيراد المعترف به أو الدفعات.") : t("Uses invoice creation dates in UTC. Amounts include recorded VAT. This is a document register, not collections or recognized revenue.", "يعتمد تاريخ إنشاء الفاتورة بتوقيت UTC. المبالغ تشمل الضريبة المسجّلة. هذا سجل مستندات؛ لا يمثل التحصيل أو الإيراد المحاسبي المعترف به.")}</p>
    <p>{t("Maximum 366 days and 5000 records. Currencies are summarized separately.", "حتى 366 يوماً و5000 سجل. تُجمع كل عملة بشكل منفصل.")}</p>
    <form onSubmit={submit}>
      <label>{t("From", "من")} <input type="date" name="from" value={filters.from} onChange={event => update("from", event.target.value)} required /></label>
      <label>{t("To", "إلى")} <input type="date" name="to" value={filters.to} onChange={event => update("to", event.target.value)} required /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId" value={filters.branchId} onChange={event => update("branchId", event.target.value)}><option value="">{t("All accessible records", "كل السجلات المتاحة")}</option>{scope.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>{t("Status", "الحالة")} <select name="status" value={filters.status} onChange={event => update("status", event.target.value)}><option value="">{t("All statuses", "كل الحالات")}</option>{statuses.map(status => <option key={status} value={status}>{t(status, labels[status])}</option>)}</select></label>
      <label>{t("Search", "بحث")} <input name="q" maxLength={120} value={filters.q} onChange={event => update("q", event.target.value)} placeholder={kind === "expenses" ? t("Number, description or category", "الرقم أو الوصف أو التصنيف") : kind === "purchase-orders" ? t("Number or saved supplier name", "الرقم أو اسم المورد المحفوظ") : t("Number or customer", "الرقم أو العميل")} /></label>
      <button disabled={busy}>{t("Show report", "عرض التقرير")}</button>
    </form>
    {error && <p role="status">{error}</p>}
    {result && successful && <><p>{result.from} — {result.to} · {t("Records", "السجلات")}: {result.count}</p>
      <p><a href={`/saved-reports?${saveParams}`}>{t("Save these filters", "حفظ هذه الفلاتر")}</a> · <a href={`/api/${kind}/report?${successful.query}&format=csv`}>{t("Download CSV", "تنزيل CSV")}</a></p>
      <div className="cards">{result.summary.map(group => <article className="card" key={`${group.status}:${group.currency}`}><strong>{t(group.status, labels[group.status])}</strong><p>{group.amount} {group.currency} · {group.count} {t("records", "سجل")}</p></article>)}</div>
      {result.categories.length > 0 && <><h3>{t("By category and status", "حسب التصنيف والحالة")}</h3>{result.categories.map(group => <p key={JSON.stringify([group.category, group.status, group.currency])}>{group.category} · {t(group.status, labels[group.status])} · {group.amount} {group.currency} · {group.count}</p>)}</>}
      {result.suppliers?.length > 0 && <><h3>{t("By supplier and status", "حسب المورد والحالة")}</h3>{result.suppliers.map(group => <p key={JSON.stringify([group.supplierId, group.supplierName, group.status, group.currency])}>{group.supplierName} · {t(group.status, labels[group.status])} · {group.amount} {group.currency} · {group.count}</p>)}</>}
      {!result.count && <p>{t("No matching records.", "لا توجد سجلات مطابقة.")}</p>}
    </>}
  </section>;
}
