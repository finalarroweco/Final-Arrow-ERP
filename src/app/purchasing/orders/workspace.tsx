"use client";

import {FinancialReport} from "@/app/accounting/financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useRef, useState } from "react";

type Rights = { canCreate: boolean; canManage: boolean; canStockAdjust: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string;
  companyPermissions: Rights; branches: ({ id: string; name: string } & Rights)[] };
type Supplier = { id: string; displayName: string; branchId: string | null };
type Order = { id: string; number: string; supplierName: string; branchId: string | null;
  status: "DRAFT" | "ISSUED" | "RECEIVED" | "CANCELLED"; currency: string; subtotal: string;
  receipts: { id: string; branchId: string; createdAt: string }[];
  _count: { receipts: number };
  lines: { id: string; description: string; quantity: number; receivedQuantity: number; unitPrice: string; amount: string }[] };
type ReceiptRequest={tenantId:string;branchId:string;requestId:string;lines:{orderLineId:string;itemId:string;quantity:number}[]};
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
  const [receiptQuantities,setReceiptQuantities]=useState<Record<string,number>>({});
  const [receiptPending,setReceiptPending]=useState(false);
  const receiptRequest=useRef<ReceiptRequest|null>(null);
  const loadGeneration=useRef(0),receiptGeneration=useRef(0);
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "0.000" }]);
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const generation=++loadGeneration.current;
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/purchase-orders?${query}`);
    const data = await response.json();
    if(generation!==loadGeneration.current)return;
    if (!response.ok) { setError(data.error ?? t("Could not load purchase orders", "تعذر تحميل أوامر الشراء")); return; }
    setOrders(data.orders); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  useEffect(() => {
    const scope = options[selected];
    if (!scope) return;
    let cancelled=false;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId });
    void fetch(`/api/suppliers?${query}`).then(async (response) => {
      const data=response.ok?await response.json():null;
      if(cancelled)return;
      setSuppliers(data?.suppliers??[]);
    });
    return ()=>{cancelled=true;};
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
  const receiptStorageKey=(order:Order)=>`erp.receipt.v1:${scope.tenantId}:${scope.companyId}:${order.id}`;
  async function selectReceiptBranch(order: Order, targetBranchId: string) {
    if (!scope) return;
    const generation=++receiptGeneration.current;
    receiptRequest.current=null;setReceiptPending(false);
    try{
      const saved=JSON.parse(sessionStorage.getItem(receiptStorageKey(order))??"null") as ReceiptRequest|null;
      if(saved&&saved.tenantId===scope.tenantId&&typeof saved.requestId==="string"&&typeof saved.branchId==="string"&&Array.isArray(saved.lines)&&saved.lines.length&&saved.lines.every(l=>order.lines.some(o=>o.id===l.orderLineId)&&typeof l.itemId==="string"&&Number.isInteger(l.quantity)&&l.quantity>0)){
        receiptRequest.current=saved;targetBranchId=saved.branchId;setReceiptPending(true);
      }
    }catch{}
    setReceiptQuantities(Object.fromEntries(order.lines.map(line=>[line.id,receiptRequest.current?receiptRequest.current.lines.find(l=>l.orderLineId===line.id)?.quantity??0:line.quantity-line.receivedQuantity])));
    setReceivingId(order.id); setReceiptBranchId(targetBranchId); setReceiptItems([]); setError(receiptRequest.current?t("Retry the previous unconfirmed delivery before entering a new one.","أعد محاولة الدفعة السابقة غير المؤكدة قبل إدخال دفعة جديدة."):"");
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      branchId: targetBranchId });
    const response = await fetch(`/api/inventory/stock?${query}`);
    const data = await response.json();
    if(generation!==receiptGeneration.current)return;
    if (!response.ok) setError(data.error ?? t("Could not load inventory items", "تعذر تحميل أصناف المخزون"));
    else setReceiptItems(data.items);
  }
  async function receive(event: React.FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault();
    if (!scope || !receiptBranchId) return;
    if(!receiptRequest.current){
      const values=new FormData(event.currentTarget);
      const selectedLines=order.lines.filter(l=>(receiptQuantities[l.id]??0)>0).map(l=>({orderLineId:l.id,itemId:String(values.get(l.id)??""),quantity:receiptQuantities[l.id]}));
      if(!selectedLines.length){setError(t("Enter a quantity on at least one line.","أدخل كمية في بند واحد على الأقل."));return;}
      receiptRequest.current={tenantId:scope.tenantId,branchId:receiptBranchId,requestId:crypto.randomUUID(),lines:selectedLines};
      try{sessionStorage.setItem(receiptStorageKey(order),JSON.stringify(receiptRequest.current));}catch{}
    }
    setBusy(true);setReceiptPending(true);setError("");
    try {
      const response=await fetch(`/api/purchase-orders/${order.id}/receive`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(receiptRequest.current)});
      const data=await response.json();
      if(!response.ok){
        if(response.status<500){receiptRequest.current=null;setReceiptPending(false);try{sessionStorage.removeItem(receiptStorageKey(order));}catch{}}
        setError(data.error??t("Could not receive purchase order","تعذر استلام أمر الشراء"));
      } else {
        receiptRequest.current=null;setReceiptPending(false);try{sessionStorage.removeItem(receiptStorageKey(order));}catch{}setReceivingId(null);setReceiptItems([]);setReportVersion(v=>v+1);await load(selected,page);
      }
    } catch {
      setError(t("The receipt result is unconfirmed. Retry this same receipt to check it safely.","نتيجة الاستلام غير مؤكدة. أعد محاولة نفس الاستلام للتحقق دون تكرار المخزون."));
    } finally {setBusy(false);}
  }
  if (!options.length) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  return <section><label>{t("Company", "الشركة")} <select disabled={busy||receiptPending} value={selected} onChange={(event) => {
    ++loadGeneration.current;++receiptGeneration.current;
    receiptRequest.current=null;setReceiptPending(false);
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
      <button type="submit" disabled={busy || receiptPending || !supplierId}>{t("Create draft", "إنشاء مسودة")} · {scope.currency}</button>
    </form>}
    <p>{t("Receive whole units in separate deliveries. Enter zero to skip a line; received quantities stay fulfilled after stock corrections. Reports include partial deliveries under Issued.","استلم كميات صحيحة على دفعات مستقلة. أدخل صفرًا لتجاوز بند؛ الكميات المستلمة تبقى محسوبة بعد تصحيح المخزون. تظهر الأوامر المستلمة جزئيًا ضمن حالة مصدرة في التقارير.")}</p>
    {error && <p role="alert">{error}</p>}
    {scope&&<FinancialReport key={`${scope.companyId}:${reportVersion}`} kind="purchase-orders" scope={scope} locale={locale}/>}
    <div className="customer-list">{orders.map((order) => {
      const canManage = order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canManage
        : scope.companyPermissions.canManage;
      const receiptBranches = scope.branches.filter((branch) => branch.canStockAdjust);
      const canReceive = canManage && (order.branchId
        ? receiptBranches.some((branch) => branch.id === order.branchId) : receiptBranches.length > 0);
      return <article key={order.id}><div><h3>{order.number} · {order.supplierName}</h3><a href={`/purchasing/orders/${order.id}`}>{t("View / print purchase order","عرض / طباعة أمر الشراء")}</a>
        <p>{order.status==="ISSUED"&&order.lines.some(l=>l.receivedQuantity>0)?t("Partially received","مستلم جزئيًا"):t(order.status, ({ DRAFT: "مسودة", ISSUED: "مصدر", RECEIVED: "مستلم", CANCELLED: "ملغى" })[order.status])} · {order.subtotal} {order.currency}</p>
        <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount} · {t("Received / remaining","المستلم / المتبقي")}: {line.receivedQuantity} / {line.quantity-line.receivedQuantity}</li>)}</ul>
        {order.receipts.map(receipt=><p key={receipt.id}><a href={`/purchasing/receipts/${receipt.id}`}>{t("View / print goods receipt","عرض / طباعة مستند الاستلام")}</a> · {receipt.createdAt.slice(0,16).replace("T"," ")} UTC · {scope.branches.find(branch=>branch.id===receipt.branchId)?.name??t("branch","فرع")}</p>)}
        {order._count.receipts>order.receipts.length&&<a href={`/purchasing/receipts?${new URLSearchParams({scope:`${scope.tenantId}:${scope.companyId}`,q:order.number})}`}>{t("Search all receipts","البحث في كل الاستلامات")}</a>}
        {canManage && <div className="quote-actions">
          {order.status === "DRAFT" && <><button disabled={busy||receiptPending} onClick={() => void change(order, "issue")}>{t("Mark issued", "إصدار الأمر")}</button>
            <button disabled={busy||receiptPending} onClick={() => void change(order, "cancel")}>{t("Cancel", "إلغاء")}</button></>}
          {order.status === "ISSUED" && canReceive && <button disabled={busy||receiptPending} onClick={() => {
            const target = order.branchId ?? receiptBranches[0].id;
            if (receivingId === order.id) setReceivingId(null);
            else void selectReceiptBranch(order, target);
          }}>{t("Receive into stock", "استلام إلى المخزون")}</button>}
        </div>}
        {receivingId === order.id && <form key={`${order.id}:${receiptBranchId}`} className="branchform" onSubmit={(event) => void receive(event, order)}>
          <h4>{t("Goods receipt · enter quantities for this delivery", "استلام البضاعة · أدخل كميات هذه الدفعة")}</h4>
          {!order.branchId && <label>{t("Receiving branch", "فرع الاستلام")} <select disabled={busy||receiptPending} value={receiptBranchId}
            onChange={(event) => void selectReceiptBranch(order, event.target.value)}>
            {receiptBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>}
          {order.lines.filter(line=>line.receivedQuantity<line.quantity).map(line=><div key={line.id} className="formrow"><label>{line.description} · {t("Remaining","المتبقي")}: {line.quantity-line.receivedQuantity}
            <select key={`${line.id}:${receiptItems.length}:${receiptPending?receiptRequest.current?.requestId:"new"}`} name={line.id} required={(receiptQuantities[line.id]??0)>0} disabled={busy||receiptPending||(receiptQuantities[line.id]??0)===0} defaultValue={receiptRequest.current?.lines.find(l=>l.orderLineId===line.id)?.itemId??""}><option value="">{t("Choose inventory item","اختر صنفًا من المخزون")}</option>
              {receiptItems.map(item=><option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}
            </select></label><label>{t("Receive now","استلام الآن")} · {line.description}<input type="number" min={0} max={line.quantity-line.receivedQuantity} step={1} required disabled={busy||receiptPending} value={receiptQuantities[line.id]??0} onChange={event=>setReceiptQuantities(v=>({...v,[line.id]:Number(event.target.value)}))}/></label></div>)}
          <button disabled={busy||(!receiptPending&&!receiptItems.length)}>{receiptPending?t("Retry same receipt","إعادة محاولة نفس الاستلام"):t("Record this delivery","تسجيل هذه الدفعة")}</button>
        </form>}
      </div></article>;
    })}</div>
    {!orders.length && <p>{t("No purchase orders on this page.", "لا توجد أوامر شراء في هذه الصفحة.")}</p>}
    {page > 0 && <button disabled={busy||receiptPending} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy||receiptPending} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
