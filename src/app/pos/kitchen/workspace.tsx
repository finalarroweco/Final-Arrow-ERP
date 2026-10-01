"use client";
import {useCallback,useEffect,useState} from "react";
import {translate,type Locale} from "@/lib/locale";
type Option={tenantId:string;companyId:string;branchId:string;label:string;canManage:boolean};
type Status="WAITING"|"PREPARING"|"READY"|"SERVED";
type Order={id:string;number:string;type:"DINE_IN"|"TAKEAWAY";tableLabel:string|null;note:string|null;status:"OPEN"|"PAID";kitchenStatus:Status;createdAt:string;prepStartedAt:string|null;readyAt:string|null;servedAt:string|null;lines:{id:string;itemName:string;quantity:number}[]};
const labels={WAITING:"بانتظار التحضير",PREPARING:"قيد التحضير",READY:"جاهز",SERVED:"تم التسليم"};
const transitions={WAITING:"PREPARING",PREPARING:"READY",READY:"SERVED"} as const;
export function KitchenWorkspace({options,locale}:{options:Option[];locale:Locale}){
 const t=useCallback((en:string,ar:string)=>translate(locale,en,ar),[locale]);const [selected,setSelected]=useState(0);const option=options[selected];
 const [status,setStatus]=useState("");const [page,setPage]=useState(0);const [next,setNext]=useState<number|null>(null);const [orders,setOrders]=useState<Order[]>([]);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [refresh,setRefresh]=useState(0);const [updated,setUpdated]=useState("");
 useEffect(()=>{
  if(!option)return;const controller=new AbortController();
  const load=async()=>{try{const response=await fetch(`/api/pos/kitchen?${new URLSearchParams({tenantId:option.tenantId,companyId:option.companyId,branchId:option.branchId,page:String(page),...(status?{status}:{})})}`,{signal:controller.signal});const data=await response.json();if(controller.signal.aborted)return;if(!response.ok){setMessage(data.error);return;}setOrders(data.orders);setNext(data.nextPage);setUpdated(new Date().toLocaleTimeString(locale==="ar"?"ar-OM":"en-GB"));}catch{if(!controller.signal.aborted)setMessage(t("Network request failed","فشل الاتصال بالشبكة"));}};
  void load();return()=>controller.abort();
 },[option,status,page,refresh,t,locale]);
 useEffect(()=>{if(busy)return;const timer=setInterval(()=>setRefresh(value=>value+1),15000);return()=>clearInterval(timer);},[busy]);
 async function advance(order:Order){if(order.kitchenStatus==="SERVED")return;setBusy(true);setMessage("");try{const response=await fetch(`/api/pos/orders/${order.id}/kitchen`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenantId:option.tenantId,status:transitions[order.kitchenStatus]})});const data=await response.json();setMessage(response.ok?t("Preparation updated","تم تحديث التحضير"):data.error);setRefresh(value=>value+1);}catch{setMessage(t("Network request failed","فشل الاتصال بالشبكة"));}finally{setBusy(false);}}
 if(!option)return <section className="panel"><p>{t("No accessible kitchen branches.","لا توجد فروع مطبخ متاحة.")}</p></section>;
 return <section className="panel"><label>{t("Branch","الفرع")} <select value={selected} disabled={busy} onChange={event=>{setSelected(Number(event.target.value));setPage(0);setNext(null);setOrders([]);setMessage("");setUpdated("");}}>{options.map((scope,index)=><option key={scope.branchId} value={index}>{scope.label}</option>)}</select></label>
 <label>{t("Preparation status","حالة التحضير")} <select value={status} disabled={busy} onChange={event=>{setStatus(event.target.value);setPage(0);setOrders([]);setUpdated("");}}><option value="">{t("Active kitchen queue","طلبات المطبخ النشطة")}</option>{Object.entries(labels).map(([value,ar])=><option key={value} value={value}>{t(value,ar)}</option>)}</select></label>
 <button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{t("Refresh","تحديث")}</button><p>{t("Refreshes every 15 seconds. Oldest orders appear first. Cancelled orders are excluded. Payment and preparation are separate.","تتحدث كل 15 ثانية، والأقدم يظهر أولاً. تُستبعد الطلبات الملغاة. الدفع والتحضير مساران منفصلان.")}</p>{updated&&<p>{t("Last updated","آخر تحديث")}: {updated}</p>}{message&&<p role="status">{message}</p>}
 <div className="cards">{orders.map(order=><article className="card" key={order.id}><strong>{order.number} · {t(order.kitchenStatus,labels[order.kitchenStatus])}</strong><p>{t(order.type,order.type==="DINE_IN"?"داخل المطعم":"سفري")} · {order.tableLabel}</p><p>{t(order.status,order.status==="PAID"?"مدفوع":"مفتوح")}</p><p>{order.createdAt.replace("T"," ").slice(0,16)} UTC</p>{order.lines.map(line=><p key={line.id}><strong>{line.quantity} × {line.itemName}</strong></p>)}{order.note&&<p>{t("Order note","ملاحظة الطلب")}: {order.note}</p>}
 {option.canManage&&order.kitchenStatus!=="SERVED"&&<button disabled={busy} onClick={()=>void advance(order)}>{t({WAITING:"Start preparation",PREPARING:"Mark ready",READY:"Mark served"}[order.kitchenStatus],{WAITING:"بدء التحضير",PREPARING:"تحديد كجاهز",READY:"تحديد كتم التسليم"}[order.kitchenStatus])}</button>}</article>)}</div>
 {orders.length===0&&<p>{t("No orders on this page.","لا توجد طلبات في هذه الصفحة.")}</p>}{page>0&&<button disabled={busy} onClick={()=>{setPage(value=>value-1);setOrders([]);}}>{t("Previous","السابق")}</button>}{next!==null&&<button disabled={busy} onClick={()=>{setPage(next);setOrders([]);}}>{t("Next","التالي")}</button>}
 </section>;
}
