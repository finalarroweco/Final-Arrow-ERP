"use client";

import { DocumentPosting } from "../document-posting";
import {FinancialReport} from "../financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Rights = { canPostLedger: boolean; canCreate: boolean; canIssue: boolean; canVoid: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Order = { id: string; number: string; customerName: string; branchId: string | null;
  status: string; currency: string; subtotal: string; invoice: { id: string } | null };
type Invoice = { id: string; number: string; orderId: string; customerName: string;
  branchId: string | null; status: "DRAFT" | "ISSUED" | "VOID"; currency: string;
  subtotal: string; voidReason: string | null;
  lines: { description: string; quantity: number; unitPrice: string; amount: string }[] };

export function InvoicesWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [reportVersion,setReportVersion]=useState(0);
  const [selected, setSelected] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  const orderRequest = useRef(0);
  const scope = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const option = options[index];
    if (!option) return;
    const request = ++requestNumber.current;
    try {
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId,
      page: String(pageNumber) });
    const response = await fetch(`/api/invoices?${query}`);
    const data = await response.json();
    if (request !== requestNumber.current) return;
    if (!response.ok) { setError(data.error ?? t("Could not load invoices", "تعذر تحميل الفواتير")); return; }
    setInvoices(data.invoices); setPage(pageNumber); setNextPage(data.nextPage); setError("");
    } catch { if (request === requestNumber.current) setError(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [options, t]);
  const loadOrders = useCallback(async (index: number) => {
    const option = options[index];
    if (!option || !(option.companyPermissions.canCreate || option.branches.some((branch) => branch.canCreate))) return;
    const request = ++orderRequest.current;
    try {
      const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId });
      const response = await fetch(`/api/orders?${query}`);
      const data = await response.json();
      if (request === orderRequest.current && response.ok) setOrders(data.orders);
    } catch { if (request === orderRequest.current) setError(t("Could not load sales orders", "تعذر تحميل طلبات البيع")); }
  }, [options, t]);
  useEffect(() => { void load(selected); void loadOrders(selected); }, [load, loadOrders, selected]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${values.get("orderId")}/invoice`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, number: values.get("number") }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not create invoice", "تعذر إنشاء الفاتورة"));
      else { setReportVersion(value=>value+1);form.reset(); await Promise.all([load(selected), loadOrders(selected)]); }
    } catch { setError(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  async function change(invoice: Invoice, action: "issue" | "void", reason?: string) {
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action, ...(action === "void" ? { reason } : {}) }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not update invoice", "تعذر تحديث الفاتورة"));
      else {setReportVersion(value=>value+1);await load(selected, page);}
    } catch { setError(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const eligibleOrders = orders.filter((order) => order.status === "COMPLETED" && !order.invoice &&
    (order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canCreate
      : scope.companyPermissions.canCreate));
  return <section><label>{t("Company", "الشركة") } <select disabled={busy} value={selected} onChange={(event) => {
    requestNumber.current++; orderRequest.current++; setSelected(Number(event.target.value)); setInvoices([]); setOrders([]); setError("");
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}</select></label>
    {(scope.companyPermissions.canCreate || scope.branches.some((branch) => branch.canCreate)) &&
      <form onSubmit={(event) => void create(event)} className="crm-form"><h2>{t("New internal invoice", "فاتورة داخلية جديدة")}</h2>
        <select name="orderId" required defaultValue=""><option value="">{t("Completed sales order", "طلب بيع مكتمل")}</option>
          {eligibleOrders.map((order) => <option key={order.id} value={order.id}>
            {order.number} · {order.customerName} · {order.subtotal} {order.currency}</option>)}</select>
        <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder={t("Invoice number, e.g. INV-001", "رقم الفاتورة، مثال INV-001")} />
        <button disabled={busy || !eligibleOrders.length}>{t("Create draft", "إنشاء مسودة")}</button>
      </form>}
    {error && <p role="alert">{error}</p>}
    <FinancialReport key={`${scope.companyId}:${reportVersion}`} kind="invoices" scope={scope} locale={locale}/>
    <div className="customer-list">{invoices.map((invoice) => {
      const rights = invoice.branchId ? scope.branches.find((branch) => branch.id === invoice.branchId)
        : scope.companyPermissions;
      return <article key={invoice.id}><div><h3>{invoice.number} · {invoice.customerName}</h3>
        <p>{t(invoice.status, ({ DRAFT: "مسودة", ISSUED: "مصدرة", VOID: "ملغاة" })[invoice.status])} · {invoice.subtotal} {invoice.currency}</p>
        {rights?.canPostLedger && invoice.status !== "DRAFT" && <DocumentPosting key={`${scope.companyId}:${invoice.id}:${invoice.status}`} kind="invoice" id={invoice.id} scope={scope} locale={locale} amount={invoice.subtotal} currency={invoice.currency} eligible={invoice.status === "ISSUED"}/>}
        <a href={`/accounting/invoices/${invoice.id}/settlements`}>{t("Collections / refunds", "التحصيلات / رد الدفعات")}</a> · <a href={`/accounting/invoices/${invoice.id}`}>{t("View / print invoice", "عرض / طباعة الفاتورة")}</a>
        <ul>{invoice.lines.map((line, index) => <li key={index}>
          {line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {invoice.voidReason && <p>{t("Void reason:", "سبب الإلغاء:")} {invoice.voidReason}</p>}
        <div className="quote-actions">
          {rights?.canIssue && invoice.status === "DRAFT" && <button disabled={busy}
            onClick={() => void change(invoice, "issue")}>{t("Mark issued", "إصدار الفاتورة")}</button>}
        </div>
        {rights?.canVoid && invoice.status !== "VOID" && <form className="formrow"
          onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget);
            void change(invoice, "void", String(values.get("reason"))); }}>
          <input name="reason" required minLength={3} maxLength={300} placeholder={t("Reason to void", "سبب الإلغاء")} />
          <button disabled={busy}>{t("Void", "إلغاء")}</button>
        </form>}
      </div></article>;
    })}</div>
    {!invoices.length && <p>{t("No invoices on this page.", "لا توجد فواتير في هذه الصفحة.")}</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
