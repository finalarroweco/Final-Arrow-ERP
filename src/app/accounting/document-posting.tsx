"use client";
import { useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
type Account = {id:string;code:string;name:string;type:string};
type Entry = {id:string;number:string;reversal?:{id:string;number:string}|null};
export function DocumentPosting({kind,id,scope,locale,amount,currency,eligible}: {
  kind:"invoice"|"expense"|"pos";id:string;scope:{tenantId:string;companyId:string};locale:Locale;amount:string;currency:string;eligible:boolean;
}) {
  const t=(en:string,ar:string)=>translate(locale,en,ar);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [accounts,setAccounts]=useState<Account[]>([]),[entry,setEntry]=useState<Entry|null>(null);
  const [nextPage,setNextPage]=useState<number|null>(null),[message,setMessage]=useState("");
  const endpoint=`/api/ledger/documents/${kind}/${id}`;
  async function accountPage(page:number) {
    const response=await fetch(`/api/ledger/accounts?${new URLSearchParams({tenantId:scope.tenantId,companyId:scope.companyId,page:String(page)})}`);
    if (!response.ok) throw new Error("accounts");
    const data=await response.json();setAccounts(old=>page===0?data.accounts:[...old,...data.accounts]);setNextPage(data.nextPage);
  }
  async function inspect() {
    setOpen(true);setBusy(true);setMessage("");setLoaded(false);
    try {
      const response=await fetch(`${endpoint}?${new URLSearchParams({tenantId:scope.tenantId})}`);
      if (!response.ok) throw new Error("journal");
      const data=await response.json();setEntry(data.entry);
      if (!data.entry) await accountPage(0);
      setLoaded(true);
    } catch {setMessage(t("Could not load ledger setup. Check your connection and ledger permissions.","تعذر تحميل إعداد الترحيل. تحقق من اتصالك وصلاحيات دفتر الأستاذ."));}
    finally {setBusy(false);}
  }
  async function post(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=new FormData(event.currentTarget);setBusy(true);setMessage("");
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        tenantId:scope.tenantId,entryDate:form.get("entryDate"),debitAccountId:form.get("debitAccountId"),creditAccountId:form.get("creditAccountId"),
      })});const data=await response.json();
      if (!response.ok) {setMessage(data.error??t("Posting failed","تعذر الترحيل"));return;}
      setEntry(data.entry);setMessage(t("Ledger journal posted","تم ترحيل القيد إلى دفتر الأستاذ"));
    } catch {setMessage(t("Connection failed. Recheck the journal before retrying.","فشل الاتصال. تحقق من القيد قبل إعادة المحاولة."));setLoaded(false);}
    finally {setBusy(false);}
  }
  const debitTypes=kind!=="expense"?["ASSET"]:["EXPENSE"],creditTypes=kind!=="expense"?["REVENUE"]:["ASSET","LIABILITY"];
  return <div className="document-posting">
    <button type="button" disabled={busy} onClick={()=>open?setOpen(false):void inspect()}>{t("Ledger posting","الترحيل المحاسبي")}</button>
    {open&&<div>
      <p>{t("Posts this document once as a balanced journal. Select the correct accounts; this does not collect or send money.","يُرحّل هذا المستند مرة واحدة بقيد متوازن. اختر الحسابات المناسبة؛ لا تُحصّل أو تُحوّل أموالاً من هنا.")}</p>
      {message&&<p role="status">{message}</p>}
      {busy&&<p role="status">{t("Working…","جاري التنفيذ…")}</p>}
      {!loaded&&!busy&&<button type="button" onClick={()=>void inspect()}>{t("Check again","إعادة التحقق")}</button>}
      {loaded&&!entry&&!eligible&&<p>{t("No linked ledger journal.","لا يوجد قيد محاسبي مرتبط.")}</p>}
      {entry?<p><a href={`/accounting/ledger/journals/${entry.id}`}>{t("View journal","عرض القيد")} · {entry.number}</a>
        {entry.reversal&&<> · <a href={`/accounting/ledger/journals/${entry.reversal.id}`}>{t("Reversed","معكوس")} · {entry.reversal.number}</a></>}</p>:
        loaded&&eligible&&<form onSubmit={event=>void post(event)}>
          <strong>{amount} {currency}</strong>
          <label>{t("Journal date","تاريخ القيد")} <input name="entryDate" type="date" required disabled={busy}/></label>
          <label>{t("Debit account","الحساب المدين")} <select name="debitAccountId" required disabled={busy} defaultValue="">
            <option value="">{t("Select account","اختر الحساب")}</option>
            {accounts.filter(a=>debitTypes.includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
          <label>{t("Credit account","الحساب الدائن")} <select name="creditAccountId" required disabled={busy} defaultValue="">
            <option value="">{t("Select account","اختر الحساب")}</option>
            {accounts.filter(a=>creditTypes.includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
          {nextPage!==null&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await accountPage(nextPage);}catch{setMessage(t("Could not load more accounts","تعذر تحميل المزيد من الحسابات"));}finally{setBusy(false);}}}>{t("More accounts","المزيد من الحسابات")}</button>}
          <a href="/accounting/ledger#ledger-accounts">{t("Set up chart of accounts","إعداد دليل الحسابات")}</a>
          <button disabled={busy}>{t("Post balanced journal","ترحيل القيد المتوازن")}</button>
        </form>}
    </div>}
  </div>;
}
