"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
export function PeriodLock({ scope, locale, onChange }: { scope: {tenantId:string;companyId:string}; locale:Locale; onChange:(date:string|null)=>void }) {
  const t = useCallback((en:string,ar:string)=>translate(locale,en,ar),[locale]);
  const [state,setState] = useState<{lockedThrough:string|null;canManage:boolean}|null>(null);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState("");
  const request = useRef(0);
  const load = useCallback(async()=>{
    const generation=++request.current;setBusy(true);
    try {
      const response=await fetch(`/api/ledger/period-lock?${new URLSearchParams({tenantId:scope.tenantId,companyId:scope.companyId})}`,{cache:"no-store"});
      const data=await response.json();if(generation!==request.current)return;
      if(response.ok){setState(data);onChange(data.lockedThrough);}else{setState(null);setMessage(data.error);}
    } catch {if(generation===request.current)setMessage(t("Network request failed","فشل الاتصال بالشبكة"));}
    finally{if(generation===request.current)setBusy(false);}
  },[scope.tenantId,scope.companyId,onChange,t]);
  useEffect(()=>{setState(null);setMessage("");void load();return()=>{request.current++;};},[load]);
  async function save(lockedThrough:string|null,reason:string){
    if(!state)return;
    const generation=++request.current;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/ledger/period-lock",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenantId:scope.tenantId,companyId:scope.companyId,lockedThrough,expectedLockedThrough:state.lockedThrough,reason})});
      const data=await response.json();if(generation!==request.current)return;
      if(response.ok){setState({...state,lockedThrough:data.lockedThrough});onChange(data.lockedThrough);setMessage(data.changed?t("Period lock updated","تم تحديث قفل الفترة"):t("Period lock is unchanged","قفل الفترة لم يتغير"));}
      else{setMessage(data.error);if(response.status===409)await load();}
    }catch{if(generation===request.current)setMessage(t("Network request failed","فشل الاتصال بالشبكة"));}finally{if(generation===request.current)setBusy(false);}
  }
  return <section className="card" id="ledger-period">
    <h2>{t("Ledger period lock","قفل الفترة المحاسبية")}</h2>
    <p>{t("Applies to this company and every branch. Journals and reversals dated on or before the cutoff are blocked. Existing entries and reports remain available. This setting does not close balances or lock operational documents.","يشمل هذه الشركة وكل فروعها. تُمنع القيود والقيود العكسية بتاريخ القفل أو قبله. تبقى القيود السابقة والتقارير متاحة. هذا الإعداد لا يقفل الأرصدة ولا المستندات التشغيلية.")}</p>
    {state&&<p><strong>{state.lockedThrough?`${t("Locked through","مقفل حتى")} ${state.lockedThrough}`:t("All entry dates are open","كل تواريخ القيود مفتوحة")}</strong></p>}
    {state?.canManage&&<form key={state.lockedThrough??"open"} onSubmit={event=>{
      event.preventDefault();const form=new FormData(event.currentTarget);const submitter=(event.nativeEvent as SubmitEvent).submitter;
      const reopen=submitter instanceof HTMLButtonElement&&submitter.value==="reopen";
      const date=String(form.get("date")??"");if(!reopen&&!date){setMessage(t("Select a cutoff date","اختر تاريخ القفل"));return;}
      void save(reopen?null:date,String(form.get("reason")??""));
    }}>
      <label>{t("Lock through (inclusive)","القفل حتى (شاملاً التاريخ)")} <input name="date" type="date" defaultValue={state.lockedThrough??""}/></label>
      <label>{t("Reason","السبب")} <input name="reason" required minLength={3} maxLength={500}/></label>
      <button disabled={busy} value="lock">{t("Set cutoff","تحديد تاريخ القفل")}</button>
      <button disabled={busy||!state.lockedThrough} value="reopen">{t("Reopen all dates","فتح كل التواريخ")}</button>
    </form>}
    <button type="button" disabled={busy} onClick={()=>{setMessage("");void load();}}>{t("Refresh lock","تحديث حالة القفل")}</button>
    {busy&&<p role="status">{t("Loading…","جارٍ التحميل…")}</p>}{message&&<p role="status">{message}</p>}
  </section>;
}
