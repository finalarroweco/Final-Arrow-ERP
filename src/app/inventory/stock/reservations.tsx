"use client";
import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import {translate,type Locale} from "@/lib/locale";
import {pendingReservation,reservationRequest,type ReservationRequest} from "@/lib/stock-reservation-input";
type Scope={tenantId:string;companyId:string;branchId:string};
type Row={id:string;quantity:string;reference:string;createdAt:string;releasedAt:string|null;releaseReason:string|null;balance:{itemId:string;item:{sku:string;name:string;unit:string}}};
type Item={id:string;sku:string;name:string;unit:string};
export function StockReservations({actorId,scope,canAdjust,items,locale,onSaved}:{actorId:string;scope:Scope;canAdjust:boolean;items:Item[];locale:Locale;onSaved:()=>void}){
 const t=useCallback((en:string,ar:string)=>translate(locale,en,ar),[locale]);
 const [rows,setRows]=useState<Row[]>([]),[page,setPage]=useState(0),[nextPage,setNextPage]=useState<number|null>(null),[state,setState]=useState("ACTIVE"),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[pending,setPending]=useState<ReservationRequest|null>(null);
 const inFlight=useRef(false),generation=useRef(0),mounted=useRef(true);
 const key=`erp-stock-reservation-v1:${actorId}:${scope.tenantId}:${scope.companyId}:${scope.branchId}`;
 const {tenantId,companyId,branchId}=scope;
 const load=useCallback(async(selectedState:string,index=0)=>{
  const n=++generation.current;
  try{const r=await fetch(`/api/inventory/reservations?${new URLSearchParams({tenantId,companyId,branchId,state:selectedState,page:String(index)})}`),data=await r.json();if(!mounted.current||n!==generation.current)return;
   if(!r.ok){setRows([]);setMessage(data.error??t("Could not load reservations","تعذر تحميل الحجوزات"));return;}setRows(data.reservations);setPage(index);setNextPage(data.nextPage);
  }catch{if(mounted.current&&n===generation.current)setMessage(t("Connection failed","فشل الاتصال"));}
 },[tenantId,companyId,branchId,t]);
 useEffect(()=>{mounted.current=true;try{const raw=sessionStorage.getItem(key);if(raw){const restored=pendingReservation(JSON.parse(raw),actorId,{tenantId,companyId,branchId});if(restored)setPending(restored);else sessionStorage.removeItem(key);}}catch{setMessage(t("Pending requests can only be retained while this page stays open.","يمكن الاحتفاظ بالطلب المعلق ما دامت الصفحة مفتوحة فقط."));}return()=>{mounted.current=false;++generation.current;};},[key,actorId,tenantId,companyId,branchId,t]);
 useEffect(()=>{void load(state);},[load,state]);
 async function save(candidate:unknown){
  if(inFlight.current)return;const p=reservationRequest.safeParse(pending??candidate);if(!p.success){setMessage(t("Check the reservation fields","راجع حقول الحجز"));return;}
  const payload=p.data;inFlight.current=true;setBusy(true);setMessage("");setPending(payload);
  try{sessionStorage.setItem(key,JSON.stringify({version:1,actorId,request:payload}));}catch{}
  try{const r=await fetch("/api/inventory/reservations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}),data=await r.json();
   if(r.ok||r.status<500){try{sessionStorage.removeItem(key);}catch{}if(mounted.current)setPending(null);}
   if(!mounted.current){if(r.ok)onSaved();return;}
   if(!r.ok){setMessage(data.error??t("Reservation could not be saved","تعذر حفظ الحجز"));return;}
   setMessage(t("Reservation change saved","تم حفظ تغيير الحجز"));onSaved();await load(state,page);
  }catch{if(mounted.current)setMessage(t("Result unconfirmed. Retry the retained request with the same details.","نتيجة الحفظ غير مؤكدة. أعد محاولة الطلب المحفوظ بنفس التفاصيل."));}
  finally{inFlight.current=false;if(mounted.current)setBusy(false);}
 }
 function reserve(event:FormEvent<HTMLFormElement>){event.preventDefault();const v=new FormData(event.currentTarget);void save({...scope,action:"reserve",requestId:crypto.randomUUID(),itemId:v.get("itemId"),quantity:v.get("quantity"),reference:v.get("reference")});}
 return <section className="panel"><h2>{t("Stock reservations","حجوزات المخزون")}</h2><p>{t("A manual hold reduces available stock without moving goods or creating accounting entries. Release the hold before physically issuing or returning its quantity. Reservations do not expire automatically and are not sales-order allocations. Quantity changes require releasing the original and recording a new hold.","الحجز اليدوي يقلل المتاح دون حركة بضاعة أو قيد محاسبي. فك الحجز قبل صرف كميته أو إرجاعها فعليًا. لا تنتهي الحجوزات تلقائيًا وليست تخصيصًا لأمر بيع. لتغيير الكمية فك الحجز الأصلي ثم سجّل حجزًا جديدًا.")}</p>
 {message&&<p role="status">{message}</p>}
 {pending&&<div role="status"><p>{t("Retained unconfirmed request","طلب محفوظ لم تتأكد نتيجته")}: {pending.action==="reserve"?`${pending.reference} · ${pending.quantity}`:pending.reason} · {pending.requestId}</p><button type="button" disabled={busy||!canAdjust} onClick={()=>void save(pending)}>{t("Retry same request","إعادة محاولة نفس الطلب")}</button></div>}
 {canAdjust&&!pending&&<form onSubmit={reserve}><fieldset disabled={busy}><legend>{t("New reservation","حجز جديد")}</legend><label>{t("Item","الصنف")}<select name="itemId" required defaultValue=""><option value="">{t("Choose item","اختر الصنف")}</option>{items.map(i=><option key={i.id} value={i.id}>{i.sku} · {i.name} ({i.unit})</option>)}</select></label><label>{t("Quantity","الكمية")}<input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"/></label><label>{t("Reservation reference","مرجع الحجز")}<input name="reference" required minLength={3} maxLength={120}/></label><button disabled={!items.length}>{t("Reserve available stock","حجز الكمية المتاحة")}</button></fieldset></form>}
 <label>{t("Reservation state","حالة الحجز")}<select value={state} disabled={busy} onChange={e=>setState(e.target.value)}><option value="ACTIVE">{t("Active","قائم")}</option><option value="RELEASED">{t("Released","مفكوك")}</option><option value="ALL">{t("All history","كل السجل")}</option></select></label><button type="button" disabled={busy} onClick={()=>void load(state,page)}>{t("Refresh reservations","تحديث الحجوزات")}</button>
 <div className="customer-list">{rows.map(r=><article key={r.id}><div><h3>{r.balance.item.sku} · {r.balance.item.name}</h3><p>{r.reference} · {r.quantity} {r.balance.item.unit}</p><p>{r.createdAt.replace("T"," ").slice(0,19)} UTC · {r.releasedAt?t("Released","مفكوك"):t("Active","قائم")}</p><small>{r.id}</small>{r.releasedAt&&<p>{r.releasedAt.replace("T"," ").slice(0,19)} UTC · {r.releaseReason}</p>}{canAdjust&&!pending&&!r.releasedAt&&<form onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget);void save({...scope,action:"release",requestId:crypto.randomUUID(),reservationId:r.id,reason:v.get("reason")});}}><label>{t("Reason for release","سبب فك الحجز")}<input name="reason" required minLength={3} maxLength={200} disabled={busy}/></label><button disabled={busy}>{t("Release full reservation","فك الحجز كاملًا")}</button></form>}</div></article>)}</div>{!rows.length&&<p>{t("No matching reservations","لا توجد حجوزات مطابقة")}</p>}
 {page>0&&<button disabled={busy} onClick={()=>void load(state,page-1)}>{t("Previous","السابق")}</button>}{nextPage!==null&&<button disabled={busy} onClick={()=>void load(state,nextPage)}>{t("Next","التالي")}</button>}
 </section>;
}
