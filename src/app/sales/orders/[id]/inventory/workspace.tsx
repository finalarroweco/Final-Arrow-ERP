"use client";
import {browserAuthLost} from "@/lib/browser-auth-loss";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {presentApiError,translate,type Locale} from "@/lib/locale";
import {orderStockHoldRequest,orderStockHoldRow,pendingOrderStockHold,confirmedOrderStockHold,confirmedClosedOrderStockHold,orderHoldCsv,availableOrderStock,type OrderStockHoldRequest,type OrderStockHoldRow} from "@/lib/order-stock-hold-input";
type Order={id:string;number:string;tenantId:string;companyId:string;branchId:string|null;status:string;lines:{id:string;position:number;description:string}[]};
type Branch={id:string;name:string;canManage:boolean;items:{id:string;sku:string;name:string;unit:string}[]};
type Props={actorId:string;order:Order;branches:Branch[];locale:Locale};
// A new actor/source must never inherit another controller's pending async state.
export function OrderStockHolds(props:Props){return <OrderStockHoldsController key={`${props.actorId}:${props.order.tenantId}:${props.order.companyId}:${props.order.id}`} {...props}/>;}
function OrderStockHoldsController({actorId,order,branches,locale}:Props){
 const t=useCallback((en:string,ar:string)=>translate(locale,en,ar),[locale]);
 const key=`order-stock-hold:v1:${actorId}:${order.tenantId}:${order.companyId}:${order.id}`;
 const [branchId,setBranchId]=useState(order.branchId??""),[state,setState]=useState("ALL"),[page,setPage]=useState(0),[nextPage,setNextPage]=useState<number|null>(null),[rows,setRows]=useState<OrderStockHoldRow[]>([]);
 const [pending,setPending]=useState<OrderStockHoldRequest|null>(null),[ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[message,setMessage]=useState("");
 const [rejected,setRejected]=useState<unknown|null>(null),[terminal,setTerminal]=useState(false);
 const [printTicket,setPrintTicket]=useState<number|null>(null);
 const outputLock=useRef(false),accessEpoch=useRef(0);
 const mounted=useRef(false),generation=useRef(0),sending=useRef(false),identity=useRef(key);identity.current=key;
 const branch=branches.find(b=>b.id===branchId),canCreate=!terminal&&Boolean(branch?.canManage)&&["NEW","IN_PROGRESS"].includes(order.status);
 const readStored=()=>{const raw=localStorage.getItem(key);if(!raw)return null;const saved=pendingOrderStockHold(JSON.parse(raw),actorId,order);if(!saved)throw new Error("Unverifiable pending request");return saved;};
 useEffect(()=>{
  const invalidation=generation;mounted.current=true;setReady(false);setPending(null);setBlocked(false);setRejected(null);setTerminal(false);
  const restore=()=>{setRejected(null);try{const raw=localStorage.getItem(key),saved=raw?pendingOrderStockHold(JSON.parse(raw),actorId,order):null;if(raw&&!saved)throw new Error("Invalid pending request");setPending(saved);if(saved)setBranchId(saved.branchId);setBlocked(false);}catch{setBlocked(true);}finally{setReady(true);}};
  restore();const changed=(event:StorageEvent)=>{if(event.key===key||event.key===null)restore();};window.addEventListener("storage",changed);
  return()=>{mounted.current=false;invalidation.current++;window.removeEventListener("storage",changed);};
 },[key,actorId,order]);
 const invalidateReads=useCallback(()=>{accessEpoch.current++;generation.current++;setRows([]);setNextPage(null);setPrintTicket(null);outputLock.current=false;setLoading(false);setRejected(null);},[]);
 const load=useCallback(async(index:number)=>{
  const version=++generation.current;setPrintTicket(null);setRows([]);setNextPage(null);setPage(index);if(!branchId)return;setLoading(true);
  try{const response=await fetch(`/api/orders/${order.id}/reservations?${new URLSearchParams({expectedActorId:actorId,tenantId:order.tenantId,companyId:order.companyId,branchId,state,page:String(index)})}`);
   if(!mounted.current||version!==generation.current)return;
   if(browserAuthLost(response)){invalidateReads();return;}
   const data=await response.json();
   if(!mounted.current||version!==generation.current)return;
   if(response.ok&&data?.actorId!==actorId){invalidateReads();return;}
   const parsed=orderStockHoldRow.array().max(50).safeParse(data?.reservations);
   if(!response.ok||data.actorId!==actorId||!parsed.success||data.page!==index||!(data.nextPage===null||data.nextPage===index+1)||parsed.data.some(r=>r.tenantId!==order.tenantId||r.orderLink.orderId!==order.id||r.balance.companyId!==order.companyId||r.balance.branchId!==branchId))throw new Error("Unavailable history");
   setRows(parsed.data);setNextPage(data.nextPage);return {rows:parsed.data,version};
  }catch{if(mounted.current&&version===generation.current)setMessage(t("Could not verify current history. Refresh before printing or exporting.","تعذر التحقق من السجل الحالي. حدّثه قبل الطباعة أو التصدير."));}
  finally{if(mounted.current&&version===generation.current)setLoading(false);}
 },[actorId,branchId,state,order.id,order.tenantId,order.companyId,t,invalidateReads]);
 useEffect(()=>{void load(0);},[load]);
 async function send(candidate:unknown,retry=false){
  if(sending.current||!ready||blocked)return;
  const parsed=orderStockHoldRequest.safeParse(candidate);if(!parsed.success){setMessage(t("Check quantity, source line and required note or reason.","راجع الكمية وبند المصدر والملاحظة أو السبب المطلوب."));return;}
  if(!retry&&(!branch?.canManage||pending||(parsed.data.action==="reserve"&&!canCreate)))return;
  sending.current=true;setBusy(true);setMessage("");setRejected(null);const ownKey=key,epoch=accessEpoch.current;
  try{
   // Serialize preparation and submission across tabs. Storage alone is not a lock.
   if(!navigator.locks)throw new Error("Safe browser locking unavailable");
   await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock){if(mounted.current&&identity.current===ownKey){const current=readStored();setPending(current);if(current)setBranchId(current.branchId);setMessage(t("This order has a request in another tab. Wait for it to finish, then refresh before acting.","يوجد طلب لهذا الأمر في تبويب آخر. انتظر انتهائه ثم حدّث الصفحة قبل المتابعة."));}return;}
    if(!mounted.current||identity.current!==ownKey)return;
    const existing=readStored();let request=parsed.data;
    if(existing){setPending(existing);setBranchId(existing.branchId);if(!retry||JSON.stringify(existing)!==JSON.stringify(request))return;request=existing;}
    else if(retry)throw new Error("Saved request is missing");
    else {const value=JSON.stringify({version:1,actorId,orderId:order.id,request});localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)throw new Error("Pending request not persisted");setPending(request);}
    try{
     const response=await fetch(`/api/orders/${order.id}/reservations`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});
     const active=()=>mounted.current&&identity.current===ownKey;
     const invalidate=()=>{if(epoch===accessEpoch.current)invalidateReads();};
     if(!active())return;
     if(browserAuthLost(response)){invalidate();throw Error("Authentication lost");}
     const result=await response.json().catch(()=>null);
     if(!active())return;
     if(browserAuthLost(response,result)){invalidate();throw Error("Authentication lost");}
     if(response.ok&&confirmedOrderStockHold(result,request,actorId,order.id)){
      const current=readStored();if(!current||JSON.stringify(current)!==JSON.stringify(request))throw new Error("Saved request changed");localStorage.removeItem(key);
      if(mounted.current&&identity.current===ownKey){setPending(null);setMessage(t("Manual hold change confirmed. History refreshed.","تأكد حفظ تغيير الحجز اليدوي. تم تحديث السجل."));await load(0);}return;
     }
     if(response.status===409&&confirmedClosedOrderStockHold(result,request,actorId,order.id)){
      const current=readStored();if(!current||JSON.stringify(current)!==JSON.stringify(request))throw new Error("Saved request changed");
      if(mounted.current&&identity.current===ownKey){setRejected(result);setTerminal(true);setMessage(t("Confirmed: this hold was not recorded because the order is permanently closed. The saved request remains until you explicitly discard it below. Existing holds still need their own full release.","تأكد عدم تسجيل هذا الحجز لأن الطلب مغلق نهائيًا. يبقى الطلب محفوظًا حتى تلغيه صراحةً أدناه. لا تزال الحجوزات القائمة بحاجة إلى فك كامل مستقل."));}return;
     }
     const detail=presentApiError(t,result,response.status);
     if(mounted.current&&identity.current===ownKey)setMessage(t("Outcome unresolved. Keep this exact request and retry. Do not replace it; restore access with an administrator if necessary.","النتيجة غير محسومة. احتفظ بالطلب نفسه وأعد المحاولة دون استبداله. اطلب من المسؤول استعادة الصلاحية عند الحاجة.")+(detail?` ${detail}`:""));
    }catch{if(mounted.current&&identity.current===ownKey)setMessage(t("Outcome uncertain. The exact request is retained. Retry it without changing its details.","النتيجة غير مؤكدة. احتُفظ بالطلب نفسه. أعد المحاولة دون تغيير تفاصيله."));}
   });
  }catch{if(mounted.current&&identity.current===ownKey){setBlocked(true);setMessage(t("Safe browser storage or locking is unavailable. Preserve browser data; no replacement request will be sent.","تخزين المتصفح الآمن أو القفل غير متاح. احتفظ ببيانات المتصفح؛ لن يُرسل طلب بديل."));}}
  finally{sending.current=false;if(mounted.current&&identity.current===ownKey)setBusy(false);}
 }
 async function discardRejected(){
  if(sending.current||busy||blocked||!ready||!pending||!confirmedClosedOrderStockHold(rejected,pending,actorId,order.id))return;
  const ownKey=key,request=pending,verdict=rejected;sending.current=true;setBusy(true);
  try{
   if(!navigator.locks)throw new Error("Safe locking unavailable");
   await navigator.locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||!mounted.current||identity.current!==ownKey)return;
    const current=readStored();
    if(!current||JSON.stringify(current)!==JSON.stringify(request)||!confirmedClosedOrderStockHold(verdict,current,actorId,order.id))throw new Error("Saved request changed");
    localStorage.removeItem(key);setPending(null);setRejected(null);
    setMessage(t("Rejected request discarded. Existing holds remain unchanged; history refreshed.","أُلغي الطلب المرفوض. لم تتغير الحجوزات القائمة؛ تم تحديث السجل."));await load(0);
   });
  }catch{if(mounted.current&&identity.current===ownKey){setBlocked(true);setRejected(null);setMessage(t("Saved request changed or storage is unavailable. Nothing was discarded. Preserve browser data and reload.","تغير الطلب المحفوظ أو التخزين غير متاح. لم يُلغَ أي طلب. احتفظ ببيانات المتصفح وأعد التحميل."));}}
  finally{sending.current=false;if(mounted.current&&identity.current===ownKey)setBusy(false);}
 }
 function reserve(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget),lineId=String(f.get("lineId")??""),item=branch?.items.find(i=>i.id===f.get("itemId"));void send({tenantId:order.tenantId,companyId:order.companyId,branchId,action:"reserve",expectedActorId:actorId,expectedUnit:item?.unit,requestId:crypto.randomUUID(),itemId:f.get("itemId"),quantity:f.get("quantity"),note:f.get("note"),...(lineId?{lineId}:{})});}
 useEffect(()=>{
  if(printTicket===null)return;
  const frame=requestAnimationFrame(()=>{if(mounted.current&&generation.current===printTicket){try{window.print();}finally{outputLock.current=false;setPrintTicket(null);}}});
  return()=>{cancelAnimationFrame(frame);outputLock.current=false;};
 },[printTicket]);
 async function output(kind:"csv"|"print"){
  if(outputLock.current||loading||busy||!branchId)return;outputLock.current=true;
  const result=await load(page);
  if(!result||!mounted.current||generation.current!==result.version){outputLock.current=false;return;}
  if(kind==="print"){setPrintTicket(result.version);return;}
  try{const url=URL.createObjectURL(new Blob(["\uFEFF"+orderHoldCsv(result.rows,page)],{type:"text/csv;charset=utf-8"})),link=document.createElement("a");link.href=url;link.download=`order-manual-holds-page-${page+1}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}finally{outputLock.current=false;}
 }
 const disabled=!ready||blocked||busy||Boolean(pending);
 return <section className="panel order-holds" data-print-ready={printTicket===null?"no":"yes"} dir={locale==="ar"?"rtl":"ltr"}><style>{`@media print{.order-holds[data-print-ready="no"]{display:none!important}header,.order-holds form,.order-holds button,.order-holds select,.order-holds aside{display:none!important}.order-holds article{break-inside:avoid}.order-holds{border:0!important;box-shadow:none!important}}`}</style><h2>{t("Order-linked manual stock holds","حجوزات مخزون يدوية مرتبطة بالطلب")}</h2>
 <p>{t("Select stock units explicitly. A sales-line label does not map an item or convert sales quantities. These holds reduce available stock only: no goods movement, delivery, invoice, valuation or accounting entry. No automatic expiry. Completing or cancelling the order never releases a hold; release it explicitly in full with a reason.","اختر وحدات المخزون صراحةً. ربط بند بيع هو وصف فقط ولا يحدد الصنف أو يحوّل كميات البيع. تقلل الحجوزات المخزون المتاح فقط دون حركة بضاعة أو تسليم أو فاتورة أو تقييم أو قيد محاسبي. لا انتهاء تلقائي. إكمال الطلب أو إلغاؤه لا يفك الحجز؛ فكّه كاملًا صراحةً مع السبب.")}</p>
 <p>{t("A new hold uses the exact stock unit displayed when you choose the item. If the unit has changed, the server rejects it without converting quantities. Retain the original request for verification; never replace its saved unit or actor with current catalog or sign-in details.","يستخدم الحجز الجديد وحدة المخزون المعروضة عند اختيار الصنف كما هي. إذا تغيرت الوحدة يرفض الخادم الطلب دون تحويل الكميات. احتفظ بالطلب الأصلي للتحقق؛ لا تستبدل وحدته أو منفذه المحفوظ ببيانات الدليل أو تسجيل الدخول الحالية.")}</p>
 <label>{t("Stock branch","فرع المخزون")}<select value={branchId} disabled={disabled||Boolean(order.branchId)} onChange={e=>{generation.current++;setRows([]);setBranchId(e.target.value);}}><option value="">{t("Choose branch explicitly","اختر الفرع صراحةً")}</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
 {blocked&&<p role="alert">{t("Saved request cannot be verified or browser storage is unavailable. Preserve browser data and resolve it before continuing.","تعذر التحقق من الطلب المحفوظ أو تخزين المتصفح غير متاح. احتفظ ببيانات المتصفح وعالج المشكلة قبل المتابعة.")}</p>}
 {message&&<p role="status">{message}</p>}
 {pending&&<aside><h3>{t("Unresolved saved request","طلب محفوظ غير محسوم")}</h3><p>{pending.requestId} · {pending.branchId}</p><p>{pending.action==="reserve"?`${pending.itemId} · ${pending.quantity} ${pending.expectedUnit} · ${pending.note}`: `${pending.reservationId} · ${pending.reason}`}</p><button type="button" disabled={!ready||blocked||busy} onClick={()=>void send(pending,true)}>{t("Retry exact saved request","إعادة إرسال الطلب المحفوظ نفسه")}</button>{confirmedClosedOrderStockHold(rejected,pending,actorId,order.id)&&<button type="button" disabled={!ready||blocked||busy} onClick={()=>void discardRejected()}>{t("Discard rejected request and reload","إلغاء الطلب المرفوض وإعادة التحميل")}</button>}</aside>}
 {!canCreate&&<p>{t("New holds require an active order and explicit order-reservation management plus stock read/adjust permissions. Existing holds remain releasable with those permissions after completion or cancellation.","يتطلب الحجز الجديد طلبًا نشطًا وإذن إدارة حجوزات الطلب وقراءة وتعديل المخزون. تبقى الحجوزات الحالية قابلة للفك بهذه الصلاحيات بعد إكمال الطلب أو إلغائه.")}</p>}
 <form onSubmit={reserve}><fieldset disabled={disabled||!canCreate}><legend>{t("New manual hold","حجز يدوي جديد")}</legend><label>{t("Optional sales-line label (no unit conversion)","وصف بند البيع اختياري (دون تحويل وحدات)")}<select name="lineId" defaultValue=""><option value="">{t("Whole-order association","ارتباط بالطلب كاملًا")}</option>{order.lines.map(l=><option key={l.id} value={l.id}>{l.position} · {l.description}</option>)}</select></label><label>{t("Stock item and unit","صنف المخزون ووحدته")}<select name="itemId" required defaultValue=""><option value="">{t("Choose item explicitly","اختر الصنف صراحةً")}</option>{branch?.items.map(i=><option key={i.id} value={i.id}>{i.sku} · {i.name} ({i.unit})</option>)}</select></label><label>{t("Quantity in the selected stock unit","الكمية بوحدة المخزون المختارة")}<input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"/></label><label>{t("Private order hold note","ملاحظة حجز الطلب الخاصة")}<input name="note" required minLength={3} maxLength={120}/></label><button type="submit">{t("Reserve available stock manually","حجز المخزون المتاح يدويًا")}</button></fieldset></form>
 <h3>{t("Permanent hold and full-release history","سجل الحجوزات والفك الكامل الدائم")}</h3><label>{t("State","الحالة")}<select value={state} disabled={busy} onChange={e=>setState(e.target.value)}><option value="ALL">{t("All history","كل السجل")}</option><option value="ACTIVE">{t("Active","قائم")}</option><option value="RELEASED">{t("Released","مفكوك")}</option></select></label><button disabled={busy||loading||!branchId} onClick={()=>void load(page)}>{t("Refresh history","تحديث السجل")}</button>
 <p>{t("Current page only, up to 50 records. Item names and units below are immutable hold-time snapshots. No totals across different units. Item units cannot change while an active order-linked hold exists; released history keeps its original unit.","الصفحة الحالية فقط، حتى ٥٠ سجلًا. أسماء الأصناف ووحداتها أدناه لقطات ثابتة وقت الحجز. لا إجماليات لوحدات مختلفة. لا تتغير وحدة الصنف أثناء وجود حجز طلب قائم؛ يحتفظ السجل المفكوك بوحدته الأصلية.")} {page+1} · {t("Filter","التصفية")}: {state}</p>
 <button disabled={loading||!rows.length} onClick={()=>void output("print")}>{t("Print current page","طباعة الصفحة الحالية")}</button><button disabled={loading||!rows.length} onClick={()=>void output("csv")}>{t("CSV current page","CSV للصفحة الحالية")}</button>
 {rows.map(r=><article key={r.id}><h4>{r.orderLink.itemSku} · {r.orderLink.itemName}</h4><p>{r.orderLink.orderNumber} · {r.orderLink.customerName} · {r.orderLink.branchName}</p><p>{r.quantity} {r.orderLink.itemUnit} · {r.orderLink.note}</p>{r.balance.item&&r.balance.quantity!==undefined&&r.balance.reservedQuantity!==undefined&&<p>{t("Current physical / reserved / available (current stock unit)","الفعلي / المحجوز / المتاح حاليًا (وحدة المخزون الحالية)")}: {r.balance.quantity} / {r.balance.reservedQuantity} / {availableOrderStock(r.balance.quantity,r.balance.reservedQuantity)} {r.balance.item.unit}</p>}{r.orderLink.lineId&&<p>{r.orderLink.linePosition} · {r.orderLink.lineDescription}</p>}<p>{t("Created UTC / actor","الإنشاء UTC / المنفذ")}: {r.createdAt} · {r.createdBy}</p><p>{t("Reservation ID","معرّف الحجز")}: {r.id}</p>{r.salesDeliveryId&&<p>{t("Released for physical delivery", "فُكّ الحجز للتسليم الفعلي")}: {r.salesDeliveryId}</p>}{r.releasedAt?<p>{t("Released UTC / actor / reason","الفك UTC / المنفذ / السبب")}: {r.releasedAt} · {r.releasedBy} · {r.releaseReason}</p>:<><p>{t("Active hold","حجز قائم")}</p>{branch?.canManage&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send({tenantId:order.tenantId,companyId:order.companyId,branchId,action:"release",expectedActorId:actorId,requestId:crypto.randomUUID(),reservationId:r.id,reason:f.get("reason")});}}><fieldset disabled={disabled}><label>{t("Permanent full-release reason","سبب الفك الكامل الدائم")}<input name="reason" required minLength={3} maxLength={200}/></label><button>{t("Release full hold","فك الحجز كاملًا")}</button></fieldset></form>}</>}</article>)}
 {!loading&&!rows.length&&<p>{t("No verified records on this page.","لا توجد سجلات متحقق منها في هذه الصفحة.")}</p>}{loading&&<p role="status">{t("Loading…","جارٍ التحميل…")}</p>}
 {page>0&&<button disabled={busy||loading} onClick={()=>void load(page-1)}>{t("Previous","السابق")}</button>}{nextPage!==null&&<button disabled={busy||loading} onClick={()=>void load(nextPage)}>{t("Next","التالي")}</button>}
 </section>;
}
