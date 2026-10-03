"use client";

import {FinancialReport} from "@/app/accounting/financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canSend: boolean; canDecide: boolean; canOrder: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string;
  companyPermissions: Permissions; branches: ({ id: string; name: string } & Permissions)[] };
type Customer = { id: string; displayName: string; branchId: string | null };
type Quote = { id: string; number: string; status: string; currency: string; subtotal: string; notes: string | null;
  order: { id: string; number: string } | null;
  branchId: string | null; customer: { displayName: string }; lines: { description: string; quantity: number;
    unitPrice: string; amount: string }[] };
type Line = { description: string; quantity: string; unitPrice: string };

export function QuotesWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const requestVersion=useRef(0);
  const [selected, setSelected] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "0.000" }]);
  const [message, setMessage] = useState("");
  const [reportVersion,setReportVersion]=useState(0);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editLines, setEditLines] = useState<Line[]>([]);
  const [ordering, setOrdering] = useState<string | null>(null);
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const generation=++requestVersion.current;
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const [quoteResponse, customerResponse] = await Promise.all([
      fetch(`/api/quotes?${query}`), fetch(`/api/customers?${new URLSearchParams({tenantId:scope.tenantId,companyId:scope.companyId,page:"0"})}`),
    ]);
    const [quoteData, customerData] = await Promise.all([quoteResponse.json(), customerResponse.json()]);
    if(generation!==requestVersion.current)return;
    if (!quoteResponse.ok) { setMessage(quoteData.error ?? t("Could not load quotes", "تعذر تحميل عروض الأسعار")); return; }
    setQuotes(quoteData.quotes); setPage(pageNumber); setNextPage(quoteData.nextPage);
    if (customerResponse.ok) {
      const allCustomers: Customer[] = [...customerData.customers];
      let customerPage: number | null = customerData.nextPage;
      while (customerPage !== null) {
        const nextQuery = new URLSearchParams({ tenantId: scope.tenantId,
          companyId: scope.companyId, page: String(customerPage) });
        const nextResponse = await fetch(`/api/customers?${nextQuery}`);
        if (!nextResponse.ok) break;
        const nextData = await nextResponse.json();
        if(generation!==requestVersion.current)return;
        allCustomers.push(...nextData.customers);
        customerPage = nextData.nextPage;
      }
      if(generation!==requestVersion.current)return;
      setCustomers(allCustomers);
    } else setCustomers([]);
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  const createBranches = option?.branches.filter((branch) => branch.canCreate) ?? [];
  const effectiveBranchId = branchId || (!option?.companyPermissions.canCreate ? createBranches[0]?.id ?? "" : "");
  const availableCustomers = customers.filter((customer) => !customer.branchId || customer.branchId === effectiveBranchId);
  async function create(form: FormData) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
          branchId: effectiveBranchId || null, customerId: form.get("customerId"), number: form.get("number"),
          notes: form.get("notes") || null,
          lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice })) }) });
      const data = await response.json();
      setMessage(response.ok ? t("Quote created", "تم إنشاء عرض السعر") : data.error ?? t("Could not create quote", "تعذر إنشاء عرض السعر"));
      if (response.ok) { setLines([{ description: "", quantity: "1", unitPrice: "0.000" }]); setReportVersion(value=>value+1); await load(selected); }
    } finally { setBusy(false); }
  }
  async function transition(quote: Quote, action: "send" | "accept" | "reject") {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, action }) });
      const data = await response.json();
      setMessage(response.ok ? `${t("Quote marked", "حالة العرض")}: ${t(data.quote.status, ({ DRAFT: "مسودة", SENT: "مرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض" })[data.quote.status as "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED"] ?? data.quote.status)}` : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) {setReportVersion(value=>value+1); await load(selected, page);}
    } finally { setBusy(false); }
  }
  function startEdit(quote: Quote) {
    setEditing(quote.id);
    setEditNotes(quote.notes ?? "");
    setEditLines(quote.lines.map((line) => ({ description: line.description,
      quantity: String(line.quantity), unitPrice: line.unitPrice })));
  }
  async function saveEdit(quote: Quote) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, notes: editNotes || null,
          lines: editLines.map((line) => ({ description: line.description,
            quantity: Number(line.quantity), unitPrice: line.unitPrice })) }) });
      const data = await response.json();
      setMessage(response.ok ? t("Draft updated", "تم تحديث المسودة") : data.error ?? t("Could not update draft", "تعذر تحديث المسودة"));
      if (response.ok) { setEditing(null); setReportVersion(value=>value+1); await load(selected, page); }
    } finally { setBusy(false); }
  }
  async function createOrder(quote: Quote, form: FormData) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}/order`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, number: form.get("number") }) });
      const data = await response.json();
      setMessage(response.ok ? t("Sales order created", "تم إنشاء طلب البيع") : data.error ?? t("Could not create order", "تعذر إنشاء طلب البيع"));
      if (response.ok) { setOrdering(null); setReportVersion(value=>value+1); await load(selected, page); }
    } finally { setBusy(false); }
  }
  if (!option) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  return <section>
    <label>{t("Company", "الشركة")} <select disabled={busy} value={selected} onChange={(event) => { requestVersion.current++;setQuotes([]);setCustomers([]);setEditing(null);setOrdering(null);setSelected(Number(event.target.value)); setBranchId(""); setMessage(""); }}>
      {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={create} className="quote-form">
      <h2>{t("New quote", "عرض سعر جديد")}</h2>
      <label>{t("Number", "الرقم")} <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="QT-001" /></label>
      <label>{t("Branch", "الفرع")} <select value={effectiveBranchId} onChange={(event) => setBranchId(event.target.value)}>
        {option.companyPermissions.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label>{t("Customer", "العميل")} <select name="customerId" required defaultValue="" key={`${selected}:${effectiveBranchId}:${customers.length}`}>
        <option value="" disabled>{t("Choose customer", "اختر العميل")}</option>
        {availableCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}
      </select></label>
      <label>{t("Notes", "ملاحظات")} <input name="notes" maxLength={2000} /></label>
      <h3>{t("Items", "البنود")} · {option.currency}</h3>
      {lines.map((line, index) => <div className="quote-line" key={index}>
        <input aria-label={`${t("Description", "الوصف")} ${index + 1}`} placeholder={t("Description", "الوصف")} required minLength={2} maxLength={300}
          value={line.description} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
        <input aria-label={`${t("Quantity", "الكمية")} ${index + 1}`} type="number" min="1" max="100000" required value={line.quantity}
          onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} />
        <input aria-label={`${t("Unit price", "سعر الوحدة")} ${index + 1}`} placeholder={t("Unit price", "سعر الوحدة")} inputMode="decimal" required
          pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?" value={line.unitPrice}
          onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} />
        {lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>{t("Remove", "حذف")}</button>}
      </div>)}
      {lines.length < 50 && <button type="button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "0.000" }])}>{t("Add item", "إضافة بند")}</button>}
      <button disabled={busy || availableCustomers.length === 0}>{t("Create quote", "إنشاء عرض سعر")}</button>
    </form>}
    {message && <p role="status">{message}</p>}<FinancialReport key={`${option.companyId}:${reportVersion}`} kind="quotes" scope={option} locale={locale}/>
    <h2>{t("Quotes", "عروض الأسعار")}</h2>
    {quotes.length === 0 && <p>{t("No quotes on this page.", "لا توجد عروض أسعار في هذه الصفحة.")}</p>}
    <div className="customer-list">{quotes.map((quote) => {
      const permissions = quote.branchId ? option.branches.find((branch) => branch.id === quote.branchId) : option.companyPermissions;
      return <article key={quote.id}>
      <div><h3>{quote.number} · {quote.customer.displayName}</h3><a href={`/sales/quotes/${quote.id}`}>{t("View / print quote","عرض / طباعة عرض السعر")}</a><p>{t(quote.status, ({ DRAFT: "مسودة", SENT: "مرسل", ACCEPTED: "مقبول", REJECTED: "مرفوض" })[quote.status as "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED"] ?? quote.status)} · {quote.subtotal} {quote.currency}</p>
        <ul>{quote.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {quote.status === "DRAFT" && permissions?.canUpdate && editing !== quote.id && <button disabled={busy}
          onClick={() => startEdit(quote)}>{t("Edit draft", "تعديل المسودة")}</button>}
        {editing === quote.id && <form className="quote-form" onSubmit={(event) => { event.preventDefault(); void saveEdit(quote); }}>
          <label>{t("Notes", "ملاحظات")} <input value={editNotes} maxLength={2000} onChange={(event) => setEditNotes(event.target.value)} /></label>
          {editLines.map((line, index) => <div className="quote-line" key={index}>
            <input aria-label={`${t("Edit description", "تعديل الوصف")} ${index + 1}`} required minLength={2} maxLength={300} value={line.description}
              onChange={(event) => setEditLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
            <input aria-label={`${t("Edit quantity", "تعديل الكمية")} ${index + 1}`} type="number" min="1" max="100000" required value={line.quantity}
              onChange={(event) => setEditLines((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} />
            <input aria-label={`${t("Edit price", "تعديل السعر")} ${index + 1}`} required inputMode="decimal"
              pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?" value={line.unitPrice}
              onChange={(event) => setEditLines((current) => current.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} />
            {editLines.length > 1 && <button type="button" onClick={() => setEditLines((current) => current.filter((_, i) => i !== index))}>{t("Remove", "حذف")}</button>}
          </div>)}
          {editLines.length < 50 && <button type="button" onClick={() => setEditLines((current) => [...current,
            { description: "", quantity: "1", unitPrice: "0.000" }])}>{t("Add item", "إضافة بند")}</button>}
          <div className="quote-actions"><button disabled={busy}>{t("Save draft", "حفظ المسودة")}</button>
            <button type="button" onClick={() => setEditing(null)}>{t("Cancel", "إلغاء")}</button></div>
        </form>}
        {quote.status === "DRAFT" && permissions?.canSend && <button disabled={busy}
          onClick={() => void transition(quote, "send")}>{t("Mark as sent", "تحديد كمرسل")}</button>}
        {quote.status === "SENT" && permissions?.canDecide && <div className="quote-actions">
          <button disabled={busy} onClick={() => void transition(quote, "accept")}>{t("Mark accepted", "قبول العرض")}</button>
          <button disabled={busy} onClick={() => void transition(quote, "reject")}>{t("Mark rejected", "رفض العرض")}</button>
        </div>}
        {quote.order && <p>{t("Sales order:", "طلب البيع:")} {quote.order.number}</p>}
        {quote.status === "ACCEPTED" && !quote.order && permissions?.canOrder && ordering !== quote.id &&
          <button disabled={busy} onClick={() => setOrdering(quote.id)}>{t("Create sales order", "إنشاء طلب بيع")}</button>}
        {ordering === quote.id && <form className="quote-actions" action={(form) => void createOrder(quote, form)}>
          <input name="number" aria-label={t("Sales order number", "رقم طلب البيع")} required pattern="[A-Z0-9-]{2,30}" placeholder="SO-001" />
          <button disabled={busy}>{t("Create", "إنشاء")}</button>
          <button type="button" onClick={() => setOrdering(null)}>{t("Cancel", "إلغاء")}</button>
        </form>}
      </div>
    </article>})}</div>
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
