"use client";

import {FinancialReport} from "@/app/accounting/financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canManage: boolean; canStockAdjust: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string;
  companyPermissions: Rights; branches: ({ id: string; name: string } & Rights)[] };
type Supplier = { id: string; displayName: string; branchId: string | null };
type Order = { id: string; number: string; supplierName: string; branchId: string | null;
  status: "DRAFT" | "ISSUED" | "RECEIVED" | "CANCELLED"; currency: string; subtotal: string;
  receipt: { id: string; branchId: string } | null;
  lines: { id: string; description: string; quantity: number; unitPrice: string; amount: string }[] };
type Item = { id: string; sku: string; name: string; unit: string };

export function PurchaseOrdersWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reportVersion,setReportVersion]=useState(0);
  const [busy, setBusy] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiptBranchId, setReceiptBranchId] = useState("");
  const [receiptItems, setReceiptItems] = useState<Item[]>([]);
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "0.000" }]);
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/purchase-orders?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not load purchase orders", "تعذر تحميل أوامر الشراء")); return; }
    setOrders(data.orders); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  useEffect(() => {
    const scope = options[selected];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId });
    void fetch(`/api/suppliers?${query}`).then(async (response) => {
      if (response.ok) setSuppliers((await response.json()).suppliers);
      else setSuppliers([]);
    });
  }, [options, selected]);
  const scope = options[selected];
  const effectiveBranchId = branchId || (!scope?.companyPermissions.canCreate
    ? scope?.branches.find((branch) => branch.canCreate)?.id ?? "" : "");
  const rights = effectiveBranchId ? scope?.branches.find((branch) => branch.id === effectiveBranchId) : scope?.companyPermissions;
  const availableSuppliers = suppliers.filter((supplier) => effectiveBranchId
    ? supplier.branchId === effectiveBranchId || supplier.branchId === null : supplier.branchId === null);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: effectiveBranchId || null,
          supplierId, number: form.get("number"), notes: form.get("notes") || null, lines }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not create purchase order", "تعذر إنشاء أمر الشراء"));
      else { (event.target as HTMLFormElement).reset(); setLines([{ description: "", quantity: 1, unitPrice: "0.000" }]);
        setReportVersion(value=>value+1); await load(selected); }
    } finally { setBusy(false); }
  }
  async function change(order: Order, action: "issue" | "cancel") {
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${order.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: scope.tenantId, action }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not update purchase order", "تعذر تحديث أمر الشراء"));
      else {setReportVersion(value=>value+1); await load(selected, page);}
    } finally { setBusy(false); }
  }
  async function selectReceiptBranch(order: Order, targetBranchId: string) {
    if (!scope) return;
    setReceivingId(order.id); setReceiptBranchId(targetBranchId); setReceiptItems([]); setError("");
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      branchId: targetBranchId });
    const response = await fetch(`/api/inventory/stock?${query}`);
    const data = await response.json();
    if (!response.ok) setError(data.error ?? t("Could not load inventory items", "تعذر تحميل أصناف المخزون"));
    else setReceiptItems(data.items);
  }
  async function receive(event: React.FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault();
    if (!scope || !receiptBranchId) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${order.id}/receive`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, branchId: receiptBranchId,
          lines: order.lines.map((line) => ({ orderLineId: line.id, itemId: values.get(line.id) })) }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? t("Could not receive purchase order", "تعذر استلام أمر الشراء"));
      else { setReceivingId(null); setReceiptItems([]); setReportVersion(value=>value+1); await load(selected, page); }
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  return <section><label>{t("Company", "الشركة")} <select disabled={busy} value={selected} onChange={(event) => {
    setSelected(Number(event.target.value)); setBranchId(""); setSupplierId(""); setSuppliers([]); setOrders([]);
    setReceivingId(null); setReceiptItems([]);
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}</select></label>
    {rights?.canCreate && <form onSubmit={(event) => void create(event)} className="branchform">
      <h2>{t("New purchase order", "أمر شراء جديد")}</h2>
      <label>{t("Scope", "النطاق")} <select value={effectiveBranchId} onChange={(event) => { setBranchId(event.target.value); setSupplierId(""); }}>
        {scope.companyPermissions.canCreate && <option value="">{t("Company-wide", "على مستوى الشركة")}</option>}
        {scope.branches.filter((branch) => branch.canCreate).map((branch) =>
          <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>{t("Supplier", "المورد")} <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
        <option value="">{t("Choose supplier", "اختر المورد")}</option>{availableSuppliers.map((supplier) =>
          <option key={supplier.id} value={supplier.id}>{supplier.displayName}</option>)}</select></label>
      <input name="number" placeholder={t("PO number, e.g. PO-001", "رقم أمر الشراء، مثال PO-001")} required pattern="[A-Z0-9-]{2,30}" />
      <textarea name="notes" placeholder={t("Notes", "ملاحظات")} maxLength={2000} />
      {lines.map((line, index) => <div key={index} className="formrow">
        <input aria-label={`${t("Item", "الصنف")} ${index + 1}`} placeholder={t("Item or service", "صنف أو خدمة")} required minLength={2} maxLength={300}
          value={line.description} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
        <input aria-label={t("Quantity", "الكمية")} type="number" min={1} max={100000} required value={line.quantity}
          onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} />
        <input aria-label={t("Unit price", "سعر الوحدة")} placeholder={t("Unit price", "سعر الوحدة")} required pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"
          value={line.unitPrice} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} />
        {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>{t("Remove", "حذف")}</button>}
      </div>)}
      {lines.length < 50 && <button type="button" onClick={() => setLines([...lines, { description: "", quantity: 1, unitPrice: "0.000" }])}>{t("Add line", "إضافة بند")}</button>}
      <button type="submit" disabled={busy || !supplierId}>{t("Create draft", "إنشاء مسودة")} · {scope.currency}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {scope&&<FinancialReport key={`${scope.companyId}:${reportVersion}`} kind="purchase-orders" scope={scope} locale={locale}/>}
    <div className="customer-list">{orders.map((order) => {
      const canManage = order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canManage
        : scope.companyPermissions.canManage;
      const receiptBranches = scope.branches.filter((branch) => branch.canStockAdjust);
      const canReceive = canManage && (order.branchId
        ? receiptBranches.some((branch) => branch.id === order.branchId) : receiptBranches.length > 0);
      return <article key={order.id}><div><h3>{order.number} · {order.supplierName}</h3><a href={`/purchasing/orders/${order.id}`}>{t("View / print purchase order","عرض / طباعة أمر الشراء")}</a>
        <p>{t(order.status, ({ DRAFT: "مسودة", ISSUED: "مصدر", RECEIVED: "مستلم", CANCELLED: "ملغى" })[order.status])} · {order.subtotal} {order.currency}</p>
        <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {order.receipt && <p><a href={`/purchasing/receipts/${order.receipt.id}`}>{t("View / print goods receipt","عرض / طباعة مستند الاستلام")}</a> · {t("Received into", "تم الاستلام في")} {scope.branches.find((branch) => branch.id === order.receipt?.branchId)?.name ?? t("branch", "فرع")}</p>}
        {canManage && <div className="quote-actions">
          {order.status === "DRAFT" && <><button disabled={busy} onClick={() => void change(order, "issue")}>{t("Mark issued", "إصدار الأمر")}</button>
            <button disabled={busy} onClick={() => void change(order, "cancel")}>{t("Cancel", "إلغاء")}</button></>}
          {order.status === "ISSUED" && canReceive && <button disabled={busy} onClick={() => {
            const target = order.branchId ?? receiptBranches[0].id;
            if (receivingId === order.id) setReceivingId(null);
            else void selectReceiptBranch(order, target);
          }}>{t("Receive into stock", "استلام إلى المخزون")}</button>}
        </div>}
        {receivingId === order.id && <form className="branchform" onSubmit={(event) => void receive(event, order)}>
          <h4>{t("Goods receipt · map every order line to an item", "استلام البضاعة · اربط كل بند بصنف")}</h4>
          {!order.branchId && <label>{t("Receiving branch", "فرع الاستلام")} <select value={receiptBranchId}
            onChange={(event) => void selectReceiptBranch(order, event.target.value)}>
            {receiptBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>}
          {order.lines.map((line) => <label key={line.id}>{line.description} · {line.quantity} {t("units", "وحدات")}
            <select name={line.id} required defaultValue=""><option value="">{t("Choose inventory item", "اختر صنفاً من المخزون")}</option>
              {receiptItems.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}
            </select></label>)}
          <button disabled={busy || !receiptItems.length}>{t("Record full receipt", "تسجيل الاستلام الكامل")}</button>
        </form>}
      </div></article>;
    })}</div>
    {!orders.length && <p>{t("No purchase orders on this page.", "لا توجد أوامر شراء في هذه الصفحة.")}</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
