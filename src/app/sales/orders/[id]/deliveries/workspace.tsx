"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { translate, type Locale } from "@/lib/locale";
import { salesStockRequest, salesStockRow, type SalesStockRow } from "@/lib/sales-stock-input";
import { orderStockHoldRow, type OrderStockHoldRow } from "@/lib/order-stock-hold-input";
import { useSalesStockRequest } from "./request";
import { validatedDeliveryDetail } from "./detail-input";
import type { DeliveryOrder, DeliveryBranch, DeliveryDetail, DeliveryTotal } from "./types";

type Props = { actorId: string; order: DeliveryOrder; branches: DeliveryBranch[]; locale: Locale };
const decimal = z.string().regex(/^-?\d+(?:\.\d{1,3})?$/);
const totalSchema = z.object({ branchId: z.string().uuid(), branchName: z.string(), itemId: z.string().uuid(), itemName: z.string(), itemSku: z.string(), unit: z.string(), delivered: decimal, returned: decimal, deliveryCorrections: decimal, returnCorrections: decimal, netOut: decimal });
export function SalesStockWorkspace(props: Props) {
  return <SalesStockController key={`${props.actorId}:${props.order.tenantId}:${props.order.companyId}:${props.order.id}`} {...props}/>;
}
function SalesStockController({ actorId, order, branches, locale }: Props) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [branchId, setBranchId] = useState(order.branchId ?? ""), [mode, setMode] = useState("manual"), [holdId, setHoldId] = useState("");
  const [holds, setHolds] = useState<OrderStockHoldRow[]>([]), [holdPage, setHoldPage] = useState(0), [holdNext, setHoldNext] = useState<number | null>(null), [holdLoading, setHoldLoading] = useState(false);
  const [rows, setRows] = useState<SalesStockRow[]>([]), [totals, setTotals] = useState<DeliveryTotal[]>([]), [page, setPage] = useState(0), [nextPage, setNextPage] = useState<number | null>(null);
  const [filters, setFilters] = useState({ branchId: "", itemId: "", q: "" }), [version, setVersion] = useState(0), [loading, setLoading] = useState(true), [message, setMessage] = useState("");
  const [detail, setDetail] = useState<DeliveryDetail | null>(null), [detailLoading, setDetailLoading] = useState(false), [printing, setPrinting] = useState(false), [printTicket, setPrintTicket] = useState(0);
  const readEpoch = useRef(0), mounted = useRef(false), detailSequence = useRef(0), printLock = useRef(false), printIdentity = useRef("");
  const branch = branches.find(b => b.id === branchId), selectedHold = holds.find(h => h.id === holdId);
  const query = new URLSearchParams({ expectedActorId: actorId, tenantId: order.tenantId, companyId: order.companyId, orderId: order.id, page: String(page), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) }).toString();
  const belongs = useCallback((row: SalesStockRow) => row.tenantId === order.tenantId && row.companyId === order.companyId && row.orderId === order.id && branches.some(b => b.id === row.branchId), [order, branches]);
  const invalidateReads = useCallback(() => {
    readEpoch.current++; detailSequence.current++; printIdentity.current = ""; printLock.current = false;
    setRows([]); setTotals([]); setNextPage(null); setHolds([]); setHoldNext(null); setHoldId("");
    setDetail(null); setPrintTicket(0); setPrinting(false); setLoading(false); setHoldLoading(false); setDetailLoading(false);
    setMessage(t("Account or access changed. Current display and printing stopped. Refresh to verify access.", "تغير الحساب أو صلاحية الوصول. تم إيقاف العرض والطباعة. حدّث للتحقق من الصلاحية."));
  }, [t]);
  const captureAuthLoss = useCallback(() => { const epoch = readEpoch.current; return () => { if (epoch === readEpoch.current) invalidateReads(); }; }, [invalidateReads]);
  const request = useSalesStockRequest(actorId, order.tenantId, order.companyId, order.id, captureAuthLoss);
  const blocked = request.blocked || request.busy || !request.ready;
  useEffect(() => { const sequence = detailSequence; mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    let active = true; const epoch = readEpoch.current; setLoading(true); setRows([]); setTotals([]); setNextPage(null);
    void (async () => { try {
      const response = await fetch(`/api/sales/stock-documents?${query}`, { cache: "no-store" });
      if (!active || epoch !== readEpoch.current) return;
      if ([401, 403].includes(response.status)) { invalidateReads(); return; }
      const data = await response.json();
      if (!active || epoch !== readEpoch.current) return;
      if (response.ok && data?.actorId !== actorId) { invalidateReads(); return; }
      const parsed = salesStockRow.array().max(50).safeParse(data.documents), grouped = totalSchema.array().safeParse(data.totals);
      if (!response.ok || data.actorId !== actorId || !parsed.success || !grouped.success || data.page !== page || !(data.nextPage === null || data.nextPage === page + 1) || parsed.data.some(row => !belongs(row)) || grouped.data.some(total => !branches.some(b => b.id === total.branchId))) throw Error("unverified register");
      if (!active || epoch !== readEpoch.current) return; setRows(parsed.data); setTotals(grouped.data); setNextPage(data.nextPage);
    } catch { if (active && epoch === readEpoch.current) setMessage(t("Could not verify the current register. Refresh to retry.", "تعذر التحقق من السجل الحالي. حدّث لإعادة المحاولة.")); }
    finally { if (active && epoch === readEpoch.current) setLoading(false); } })();
    return () => { active = false; };
  }, [query, page, version, belongs, branches, t, actorId, invalidateReads]);
  useEffect(() => {
    let active = true; const epoch = readEpoch.current; setHolds([]); setHoldNext(null); setHoldId("");
    if (mode !== "hold" || !branch?.canDeliverHold) { setHoldLoading(false); return; }
    setHoldLoading(true);
    void (async () => { try {
      const params = new URLSearchParams({ expectedActorId: actorId, tenantId: order.tenantId, companyId: order.companyId, branchId: branch.id, state: "ACTIVE", page: String(holdPage) });
      const response = await fetch(`/api/orders/${order.id}/reservations?${params}`, { cache: "no-store" });
      if (!active || epoch !== readEpoch.current) return;
      if ([401, 403].includes(response.status)) { invalidateReads(); return; }
      const data = await response.json();
      if (!active || epoch !== readEpoch.current) return;
      if (response.ok && data?.actorId !== actorId) { invalidateReads(); return; }
      const parsed = orderStockHoldRow.array().max(50).safeParse(data.reservations);
      if (!response.ok || data.actorId !== actorId || !parsed.success || data.page !== holdPage || !(data.nextPage === null || data.nextPage === holdPage + 1) || parsed.data.some(h => h.tenantId !== order.tenantId || h.orderLink.orderId !== order.id || h.balance.companyId !== order.companyId || h.balance.branchId !== branch.id || h.releasedAt !== null)) throw Error("unverified hold");
      if (active) { setHolds(parsed.data); setHoldNext(data.nextPage); }
    } catch { if (active && epoch === readEpoch.current) setMessage(t("Active holds could not be verified. Refresh the holds before choosing one.", "تعذر التحقق من الحجوزات القائمة. حدّث الحجوزات قبل اختيار أحدها.")); }
    finally { if (active && epoch === readEpoch.current) setHoldLoading(false); } })();
    return () => { active = false; };
  }, [mode, branch, holdPage, order, version, t, actorId, invalidateReads]);
  useEffect(() => {
    if (!printTicket || !detail || printIdentity.current !== detail.document.id) return;
    const epoch = readEpoch.current;
    const frame = requestAnimationFrame(() => { if (mounted.current && epoch === readEpoch.current && printIdentity.current === detail.document.id) { try { window.print(); } finally { printLock.current = false; setPrinting(false); setPrintTicket(0); } } });
    return () => cancelAnimationFrame(frame);
  }, [printTicket, detail]);
  const label = (kind: SalesStockRow["kind"]) => kind === "DELIVERY" ? t("Delivery", "تسليم") : kind === "RETURN" ? t("Usable-stock return", "إرجاع مخزون صالح") : t("Full correction", "تصحيح كامل");
  function failed() { setMessage(t("Outcome unconfirmed. The exact saved request is retained. Retry it or ask the server to check and abandon it. Do not record a replacement.", "النتيجة غير مؤكدة. احتُفظ بالطلب نفسه. أعد المحاولة أو اطلب من الخادم التحقق والإلغاء. لا تسجل طلبًا بديلًا.")); }
  function saved(row: SalesStockRow) { setMessage(t("Document saved. History refreshed; order status and financial records are unchanged.", "تم حفظ المستند وتحديث السجل دون تغيير حالة الطلب أو السجلات المالية.")); setPage(0); setVersion(v => v + 1); void openDetail(row); }
  async function submit(candidate: unknown) {
    const parsed = salesStockRequest.safeParse(candidate);
    if (!parsed.success) { setMessage(t("Check the required fields, the explicit confirmation, and a stock quantity from 0.001 to 999999999.999 with at most three decimals.", "راجع الحقول المطلوبة والتأكيد الصريح وكمية المخزون من 0.001 إلى 999999999.999 بثلاث منازل عشرية كحد أقصى.")); return; }
    setMessage(""); await request.run(parsed.data, saved, failed);
  }
  const base = (reason: FormDataEntryValue | null, expectedUnit: string | undefined) => ({ tenantId: order.tenantId, companyId: order.companyId, orderId: order.id, expectedActorId: actorId, requestId: crypto.randomUUID(), reason, expectedUnit });
  function deliver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (blocked || !branch?.canManage || order.status === "CANCELLED") return;
    const f = new FormData(event.currentTarget), hold = mode === "hold" ? selectedHold : undefined;
    if (mode === "hold" && (!branch.canDeliverHold || !hold)) return;
    const item = branch.items.find(i => i.id === f.get("itemId"));
    void submit({ ...base(f.get("reason"), hold?.orderLink.itemUnit ?? item?.unit), action: "deliver", branchId, itemId: hold?.balance.itemId ?? f.get("itemId"), lineId: hold ? hold.orderLink.lineId : f.get("lineId") || null, holdId: hold?.id ?? null, quantity: hold?.quantity ?? f.get("quantity"), reference: f.get("reference"), physicalConfirmed: f.get("physicalConfirmed") === "on" });
  }
  async function openDetail(row: SalesStockRow, print = false) {
    if (print && printLock.current) return;
    if (print) { printLock.current = true; setPrinting(true); }
    printIdentity.current = "";
    const epoch = readEpoch.current, sequence = ++detailSequence.current; setDetailLoading(true); setPrintTicket(0); if (!print) setDetail(null);
    try {
      const response = await fetch(`/api/sales/stock-documents/${row.id}?tenantId=${order.tenantId}&expectedActorId=${actorId}`, { cache: "no-store" });
      if (!mounted.current || sequence !== detailSequence.current || epoch !== readEpoch.current) return;
      if ([401, 403].includes(response.status)) { invalidateReads(); return; }
      const data = await response.json();
      if (!mounted.current || sequence !== detailSequence.current || epoch !== readEpoch.current) return;
      if (response.ok && data?.actorId !== actorId) { invalidateReads(); return; }
      const checked = validatedDeliveryDetail(data, row);
      if (!response.ok || data.actorId !== actorId || !checked || !belongs(checked.document)) throw Error("unverified detail");
      if (!mounted.current || sequence !== detailSequence.current || epoch !== readEpoch.current) return;
      setDetail(checked); if (print) { printIdentity.current = row.id; setPrintTicket(sequence); }
    } catch { if (mounted.current && sequence === detailSequence.current && epoch === readEpoch.current) { setDetail(null); setMessage(t("Current access and document history could not be verified. Display and printing stopped. Refresh to retry.", "تعذر التحقق من صلاحية الوصول وسجل المستند الحالي. تم إيقاف العرض والطباعة. حدّث لإعادة المحاولة.")); } }
    finally { if (mounted.current && sequence === detailSequence.current && epoch === readEpoch.current) { setDetailLoading(false); if (!print || printIdentity.current !== row.id) { printLock.current = false; setPrinting(false); } } }
  }
  return <section className="sales-stock-container" data-print-ready={printTicket ? "yes" : "no"} dir={locale === "ar" ? "rtl" : "ltr"}>
    <style>{`@media print { header,.hero,.sales-stock-no-print {display:none!important} .sales-stock-container[data-print-ready="no"] {display:none!important} .sales-stock-detail {color:#000;background:#fff;box-shadow:none!important} .sales-stock-detail article {break-inside:avoid} }`}</style>
    <div className="sales-stock-no-print">
      <p>{t("Record physical goods movements at the current time. Choose stock units explicitly. A sales-line label does not map an item or convert a commercial quantity. Delivery does not complete an order or create an invoice, tax, credit, refund or journal.", "سجّل حركة البضاعة الفعلية بالتوقيت الحالي. اختر وحدات المخزون صراحةً. وصف بند البيع لا يحدد الصنف ولا يحوّل الكمية التجارية. التسليم لا يكمل الطلب ولا ينشئ فاتورة أو ضريبة أو إشعارًا دائنًا أو ردًا ماليًا أو قيدًا.")}</p>
      <p>{t("New deliveries are allowed on new, in-progress and completed orders, not cancelled orders. Returns and corrections remain available after closure. Nothing here arranges shipping or recreates a released hold.", "يمكن تسجيل تسليم جديد للطلبات الجديدة وقيد التنفيذ والمكتملة، وليس الملغاة. تبقى المرتجعات والتصحيحات متاحة بعد الإغلاق. لا يرتب هذا الإجراء الشحن ولا يعيد إنشاء حجز مفكوك.")}</p>
      {!request.ready && <p role="alert">{t("Safe browser storage or locking is unavailable. Saving is disabled.", "التخزين الآمن أو قفل الطلبات غير متاح في المتصفح. تم تعطيل الحفظ.")}</p>}
      {request.blocked && <aside><h2>{t("Unconfirmed saved request", "طلب محفوظ غير مؤكد")}</h2><p>{t("This exact request may already be recorded. Reloading or opening another tab must not create a replacement.", "قد يكون هذا الطلب مسجلاً بالفعل. إعادة التحميل أو فتح تبويب آخر لا ينبغي أن ينشئ طلبًا بديلًا.")}</p>
        {request.pending ? <><p>{request.pending.requestId} · {request.pending.reason} · {request.pending.expectedUnit}</p><p>{request.pending.action === "deliver" ? `${request.pending.reference} · ${request.pending.quantity} · ${request.pending.branchId} · ${request.pending.itemId}` : request.pending.action === "return" ? `${request.pending.deliveryId} · ${request.pending.quantity} · ${request.pending.reference}` : request.pending.documentId}</p>
          <button type="button" disabled={request.busy || !request.ready} onClick={() => void request.run(null, saved, failed)}>{t("Retry exact saved request", "إعادة إرسال الطلب المحفوظ نفسه")}</button> <button type="button" disabled={request.busy || !request.ready} onClick={() => { if (window.confirm(t("Check and abandon this request? An already recorded document will be shown instead. This does not reverse stock or release a hold.", "هل تريد التحقق من الطلب وإلغاءه؟ سيظهر المستند إذا كان مسجلاً بالفعل. هذا لا يعكس المخزون ولا يفك حجزًا."))) void request.abandon(saved, failed, () => { setMessage(t("Request safely abandoned. Its UUID cannot record a later duplicate. Stock and holds are unchanged.", "تم إلغاء الطلب بأمان ولا يمكن لمعرّفه تسجيل نسخة لاحقة. المخزون والحجوزات لم تتغير.")); setVersion(v => v + 1); }); }}>{t("Check and abandon request", "التحقق من الطلب وإلغاؤه")}</button></> : <p>{t("The saved request cannot be read safely and has been retained. Preserve browser data and ask for help before continuing.", "تعذرت قراءة الطلب المحفوظ بأمان وتم الاحتفاظ به. احتفظ ببيانات المتصفح واطلب المساعدة قبل المتابعة.")}</p>}
      </aside>}
      {message && <p role="status">{message}</p>}
      <form className="crm-form" onSubmit={deliver}><h2>{t("Record physical delivery", "تسجيل التسليم الفعلي")}</h2><fieldset disabled={blocked || order.status === "CANCELLED"}>
        <label>{t("Stock branch", "فرع المخزون")}<select value={branchId} required disabled={Boolean(order.branchId)} onChange={event => { setBranchId(event.target.value); setMode("manual"); setHoldPage(0); setHoldId(""); }}><option value="">{t("Choose explicitly", "اختر صراحةً")}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <fieldset disabled={!branch?.canManage}><label>{t("Stock source", "مصدر المخزون")}<select value={mode} onChange={event => { setMode(event.target.value); setHoldPage(0); setHoldId(""); }}><option value="manual">{t("Unreserved available stock", "المخزون المتاح غير المحجوز")}</option>{branch?.canDeliverHold && <option value="hold">{t("Entire explicitly selected order hold", "كامل حجز الطلب المختار صراحةً")}</option>}</select></label>
          {mode === "manual" ? <><p>{t("Quantity must fit physical stock minus all reserved stock. Existing holds are unchanged.", "يجب ألا تتجاوز الكمية المخزون الفعلي ناقص جميع الحجوزات. لا تتغير الحجوزات القائمة.")}</p>
            <label>{t("Stock item and unit", "صنف المخزون ووحدته")}<select key={branchId} name="itemId" required defaultValue=""><option value="">{t("Choose explicitly", "اختر صراحةً")}</option>{branch?.items.map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}</select></label>
            <label>{t("Optional descriptive sales line", "بند بيع وصفي اختياري")}<select name="lineId" defaultValue=""><option value="">{t("Whole-order association", "ارتباط بالطلب كاملًا")}</option>{order.lines.map(line => <option key={line.id} value={line.id}>{line.position} · {line.description}</option>)}</select></label>
            <label>{t("Stock quantity (0.001–999999999.999)", "كمية المخزون (0.001–999999999.999)")}<input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"/></label></> : <>
            <p>{t("Choose one active hold. Its entire exact quantity is released and physically withdrawn together. No partial or automatic hold selection. Returns and corrections never reopen the hold.", "اختر حجزًا قائمًا واحدًا. تُفك كميته كاملة وتُسحب فعليًا في عملية واحدة. لا اختيار تلقائي أو جزئي للحجوزات. المرتجعات والتصحيحات لا تعيد فتح الحجز.")}</p>
            <label>{t("Active order hold", "حجز الطلب القائم")}<select value={holdId} required disabled={holdLoading} onChange={event => setHoldId(event.target.value)}><option value="">{t("Choose one full hold explicitly", "اختر حجزًا كاملًا واحدًا صراحةً")}</option>{holds.map(hold => <option key={hold.id} value={hold.id}>{hold.orderLink.itemSku} · {hold.orderLink.itemName} · {hold.quantity} {hold.orderLink.itemUnit} · {hold.orderLink.note} · {hold.id}</option>)}</select></label>
            {selectedHold && <p>{selectedHold.orderLink.branchName} · {selectedHold.orderLink.lineDescription ?? t("Whole order", "الطلب كاملًا")} · {selectedHold.quantity} {selectedHold.orderLink.itemUnit}</p>}
            <button type="button" disabled={holdLoading || holdPage === 0} onClick={() => setHoldPage(p => p - 1)}>{t("Previous holds", "الحجوزات السابقة")}</button> <button type="button" disabled={holdLoading || holdNext === null} onClick={() => { if (holdNext !== null) setHoldPage(holdNext); }}>{t("Next holds", "الحجوزات التالية")}</button> <button type="button" disabled={holdLoading} onClick={() => setVersion(v => v + 1)}>{t("Refresh holds", "تحديث الحجوزات")}</button>
          </>}
          <label>{t("Reference", "المرجع")}<input name="reference" required minLength={3} maxLength={120}/></label><label>{t("Reason", "السبب")}<input name="reason" required minLength={3} maxLength={300}/></label>
          <label><input type="checkbox" name="physicalConfirmed" required/>{t("I confirm these goods physically left this branch in the displayed stock unit.", "أؤكد خروج هذه البضاعة فعليًا من هذا الفرع بوحدة المخزون المعروضة.")}</label><button type="submit">{t("Record delivery", "تسجيل التسليم")}</button>
        </fieldset></fieldset></form>
      {order.status === "CANCELLED" && <p>{t("This order is cancelled. New deliveries are disabled; source-linked returns and corrections remain available with current permissions.", "هذا الطلب ملغى. تم تعطيل التسليم الجديد؛ تبقى المرتجعات والتصحيحات المرتبطة بالمصدر متاحة بالصلاحيات الحالية.")}</p>}
      <h2>{t("Permanent delivery register", "سجل التسليم الدائم")}</h2>
      <form className="crm-form" onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); setPage(0); setFilters({ branchId: String(f.get("branchId") ?? ""), itemId: String(f.get("itemId") ?? ""), q: String(f.get("q") ?? "").trim() }); }}>
        <label>{t("Branch", "الفرع")}<select name="branchId" defaultValue=""><option value="">{t("All readable branches", "كل الفروع المتاحة")}</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>{t("Item", "الصنف")}<select name="itemId" defaultValue=""><option value="">{t("All items, including historical", "كل الأصناف بما فيها التاريخية")}</option>{[...new Map(branches.flatMap(b => b.items).map(item => [item.id, item])).values()].map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
        <label>{t("Search reference or item", "بحث بالمرجع أو الصنف")}<input name="q" maxLength={120}/></label><button>{t("Apply filters", "تطبيق التصفية")}</button></form>
      <button type="button" disabled={loading} onClick={() => { setMessage(""); setVersion(v => v + 1); }}>{t("Refresh register", "تحديث السجل")}</button> <a href={`/api/sales/stock-documents?${query}&format=csv`}>{t("Export filtered CSV (current access checked)", "تصدير CSV حسب التصفية (بعد التحقق من الصلاحية)")}</a>
      {loading ? <p role="status">{t("Loading…", "جارٍ التحميل…")}</p> : !rows.length && <p>{t("No verified documents on this page.", "لا توجد مستندات متحقق منها في هذه الصفحة.")}</p>}
      {rows.map(row => <article key={row.id}><h3><button type="button" disabled={detailLoading || printing} onClick={() => void openDetail(row)}>{label(row.kind)} · {row.reference}</button></h3><p>{row.branchName} · {row.itemSku} · {row.itemName} · {row.quantity} {row.unit}</p><p>{row.createdAt} · {row.actorName}</p>{row.holdId && <p>{t("Entire selected hold delivered", "تم تسليم كامل الحجز المختار")}: {row.holdId}</p>}</article>)}
      <p>{t("Page", "صفحة")} {page + 1}</p><button type="button" disabled={loading || page === 0} onClick={() => setPage(p => p - 1)}>{t("Previous", "السابق")}</button> <button type="button" disabled={loading || nextPage === null} onClick={() => { if (nextPage !== null) setPage(nextPage); }}>{t("Next", "التالي")}</button>
      <h3>{t("Filtered totals by branch, item and historical unit", "الإجماليات حسب الفرع والصنف والوحدة التاريخية")}</h3><p>{t("No totals across different units. These physical records do not measure commercial demand or fulfilment progress.", "لا جمع لوحدات مختلفة. لا تقيس هذه السجلات الفعلية الطلب التجاري أو نسبة إنجازه.")}</p>
      {totals.map(total => <article key={`${total.branchId}:${total.itemId}:${total.unit}`}><strong>{total.branchName} · {total.itemSku} · {total.itemName} · {total.unit}</strong><p>{t("Delivered / returned / delivery corrections / return corrections / net out", "المسلّم / المرتجع / تصحيحات التسليم / تصحيحات الإرجاع / صافي الصادر")}: {total.delivered} / {total.returned} / {total.deliveryCorrections} / {total.returnCorrections} / {total.netOut}</p></article>)}
      {detailLoading && <p role="status">{t("Verifying current document access and history…", "جارٍ التحقق من صلاحية المستند وسجله الحالي…")}</p>}
    </div>
    {detail && <section className="sales-stock-detail"><h2>{label(detail.document.kind)} · {detail.document.reference}</h2>
      <dl><dt>{t("Order / customer", "الطلب / العميل")}</dt><dd>{detail.document.orderNumber} · {detail.document.customerName}</dd><dt>{t("Company / original stock branch", "الشركة / فرع المخزون الأصلي")}</dt><dd>{detail.document.companyName} · {detail.document.branchName}</dd><dt>{t("Item / historical stock unit", "الصنف / وحدة المخزون التاريخية")}</dt><dd>{detail.document.itemSku} · {detail.document.itemName} · {detail.document.quantity} {detail.document.unit}</dd><dt>{t("Source line (descriptive only)", "بند المصدر (وصفي فقط)")}</dt><dd>{detail.document.lineDescription ?? t("Whole order", "الطلب كاملًا")}</dd><dt>{t("Reason", "السبب")}</dt><dd>{detail.document.reason}</dd><dt>{t("Recorded UTC / actor", "التسجيل UTC / المنفذ")}</dt><dd>{detail.document.createdAt} · {detail.document.actorName}</dd><dt>{t("Document ID", "معرّف المستند")}</dt><dd>{detail.document.id}</dd></dl>
      {detail.document.deliveryId && <p>{t("Source delivery", "التسليم المصدر")}: {detail.document.deliveryId}</p>}{detail.document.correctsId && <p>{t("Corrected original document", "المستند الأصلي المصحح")}: {detail.document.correctsId}</p>}{detail.document.holdId && <p>{t("Entire hold released for this delivery", "الحجز المفكوك كاملًا لهذا التسليم")}: {detail.document.holdId}</p>}
      <p>{t("Recorded at database time. This document has no invoice, refund, tax, valuation, journal or order-status effect. Returns and corrections do not recreate holds.", "سُجل بتوقيت قاعدة البيانات. لا يؤثر في الفواتير أو الاسترداد أو الضريبة أو التقييم أو القيود أو حالة الطلب. المرتجعات والتصحيحات لا تعيد إنشاء الحجوزات.")}</p>
      <h3>{t("Correction history", "سجل التصحيحات")}</h3>{detail.corrections.map(row => <article key={row.id}><p>{row.id} · {row.quantity} {row.unit} · {row.reason} · {row.createdAt} · {row.actorName}</p></article>)}
      {detail.document.kind === "DELIVERY" && <><h3>{t("Return history (original events remain after correction)", "سجل المرتجعات (تبقى الحركات الأصلية بعد التصحيح)")}</h3>{detail.returns.map(row => <article key={row.id}><p>{row.reference} · {row.quantity} {row.unit} · {row.reason} · {row.createdAt}</p><button className="sales-stock-no-print" type="button" disabled={printing || detailLoading} onClick={() => void openDetail(row)}>{t("View return and its corrections", "عرض المرتجع وتصحيحاته")}</button></article>)}{detail.returnCorrections.map(row => <article key={row.id}><p>{t("Full return correction", "تصحيح كامل للمرتجع")}: {row.correctsId} · {row.quantity} {row.unit} · {row.reason} · {row.createdAt}</p></article>)}<p>{t("Currently returnable", "القابل للإرجاع حاليًا")}: {detail.returnableQuantity} {detail.document.unit}</p></>}
      <div className="sales-stock-no-print"><button type="button" disabled={printing || detailLoading} onClick={() => void openDetail(detail.document, true)}>{t("Verify and print document", "التحقق وطباعة المستند")}</button> <button type="button" disabled={printing || detailLoading} onClick={() => void openDetail(detail.document)}>{t("Refresh document", "تحديث المستند")}</button> <button type="button" disabled={printing} onClick={() => { detailSequence.current++; setDetail(null); setPrintTicket(0); }}>{t("Close document", "إغلاق المستند")}</button>
        {detail.canReturn && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void submit({ ...base(f.get("reason"), detail.document.unit), action: "return", deliveryId: detail.document.id, quantity: f.get("quantity"), reference: f.get("reference"), usableConfirmed: f.get("usableConfirmed") === "on" }); }}><fieldset disabled={blocked}><legend>{t("Restore a partial usable-stock return", "إرجاع جزئي إلى المخزون الصالح")}</legend><p>{t("Only the original item, unit and branch are allowed. Damaged, quarantined and cross-branch returns are not supported. Current item unit must still match this document.", "يسمح فقط بالصنف والوحدة والفرع الأصليين. لا يدعم البضاعة التالفة أو المحجورة أو الإرجاع لفرع آخر. يجب أن تطابق وحدة الصنف الحالية هذا المستند.")}</p><label>{t("Returned quantity", "الكمية المرتجعة")}<input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"/></label><label>{t("Reference", "المرجع")}<input name="reference" required minLength={3} maxLength={120}/></label><label>{t("Reason", "السبب")}<input name="reason" required minLength={3} maxLength={300}/></label><label><input type="checkbox" name="usableConfirmed" required/>{t("I confirm these goods were physically returned to the original branch and are usable stock.", "أؤكد إرجاع هذه البضاعة فعليًا للفرع الأصلي وأنها صالحة للاستخدام ضمن المخزون.")}</label><button>{t("Record usable-stock return", "تسجيل إرجاع مخزون صالح")}</button></fieldset></form>}
        {detail.canCorrect && <form onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void submit({ ...base(f.get("reason"), detail.document.unit), action: "correct", documentId: detail.document.id, physicalConfirmed: f.get("physicalConfirmed") === "on" }); }}><fieldset disabled={blocked}><legend>{t("Correct the full original document once", "تصحيح المستند الأصلي كاملًا مرة واحدة")}</legend><p>{t("Records the exact opposite stock movement and preserves the original. Correct dependent returns first. A return correction requires unreserved available stock. Corrections cannot themselves be corrected, and no hold is recreated.", "يسجل حركة مخزون معاكسة تمامًا مع حفظ الأصل. صحح المرتجعات التابعة أولًا. يتطلب تصحيح الإرجاع مخزونًا متاحًا غير محجوز. لا يمكن تصحيح التصحيح نفسه ولا يُعاد إنشاء حجز.")}</p><label>{t("Correction reason", "سبب التصحيح")}<input name="reason" required minLength={3} maxLength={300}/></label><label><input type="checkbox" name="physicalConfirmed" required/>{t("I confirm the full opposite stock adjustment is correct now, in the original unit.", "أؤكد صحة تعديل المخزون المعاكس كاملًا الآن وبالوحدة الأصلية.")}</label><button>{t("Record full correction", "تسجيل التصحيح الكامل")}</button></fieldset></form>}
      </div></section>}
  </section>;
}
