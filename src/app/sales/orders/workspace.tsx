"use client";

import {FinancialReport} from "@/app/accounting/financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string; canManageCompanyWide: boolean;
  branches: { id: string; name: string; canManage: boolean }[] };
type Order = { id: string; number: string; quoteId: string; customerName: string;
  status: "NEW" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; branchId: string | null;
  currency: string; subtotal: string; lines: { description: string; quantity: number;
    unitPrice: string; amount: string }[] };

export function OrdersWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const requestVersion=useRef(0);
  const [selected, setSelected] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reportVersion,setReportVersion]=useState(0);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const generation=++requestVersion.current;
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/orders?${query}`);
    const data = await response.json();
    if(generation!==requestVersion.current)return;
    if (!response.ok) { setError(data.error ?? t("Could not load orders", "تعذر تحميل الطلبات")); return; }
    setOrders(data.orders); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function change(order: Order, action: "start" | "complete" | "cancel") {
    const scope = options[selected];
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not update order", "تعذر تحديث الطلب"));
      else {setReportVersion(value=>value+1); await load(selected, page);}
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  return <section><label>{t("Company", "الشركة")} <select disabled={busy} value={selected} onChange={(event) => {requestVersion.current++;setOrders([]);setError("");setSelected(Number(event.target.value));}}>
    {options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}<FinancialReport key={`${options[selected].companyId}:${reportVersion}`} kind="orders" scope={options[selected]} locale={locale}/>
    <div className="customer-list">{orders.map((order) => {
      const scope = options[selected];
      const canManage = order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canManage
        : scope.canManageCompanyWide;
      return <article key={order.id}><div>
      <h3>{order.number} · {order.customerName}</h3><a href={`/sales/orders/${order.id}`}>{t("View / print order","عرض / طباعة طلب البيع")}</a><p>{t(order.status.replace("_", " "), ({ NEW: "جديد", IN_PROGRESS: "قيد التنفيذ", COMPLETED: "مكتمل", CANCELLED: "ملغى" })[order.status])} · {order.subtotal} {order.currency}</p>
      <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
      {canManage && <div className="quote-actions">
        {order.status === "NEW" && <button disabled={busy} onClick={() => void change(order, "start")}>{t("Start work", "بدء العمل")}</button>}
        {order.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => void change(order, "complete")}>{t("Complete", "إكمال")}</button>}
        {["NEW", "IN_PROGRESS"].includes(order.status) && <button disabled={busy}
          onClick={() => void change(order, "cancel")}>{t("Cancel", "إلغاء")}</button>}
      </div>}
    </div></article>})}</div>
    {!orders.length && <p>{t("No orders on this page.", "لا توجد طلبات في هذه الصفحة.")}</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
