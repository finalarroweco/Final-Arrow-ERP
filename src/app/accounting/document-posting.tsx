"use client";
import { useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
type Account = {id:string;code:string;name:string;type:string};
type Entry = {id:string;number:string;reversal?:{id:string;number:string}|null};
export function DocumentPosting({kind,id,scope,locale,amount,currency,eligible,deductions,canPost=true}: {
  kind:"invoice"|"expense"|"pos"|"payroll"|"payroll-payment"|"purchase-receipt"|"purchase-return";id:string;scope:{tenantId:string;companyId:string};locale:Locale;amount:string;currency:string;eligible:boolean;deductions?:string;canPost?:boolean;
}) {
  const t=(en:string,ar:string)=>translate(locale,en,ar);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [accounts,setAccounts]=useState<Account[]>([]),[entry,setEntry]=useState<Entry|null>(null);
  const [nextPage,setNextPage]=useState<number|null>(null),[message,setMessage]=useState("");
  const [purchaseSetup,setPurchaseSetup]=useState<{entry:Entry;debitAccountId:string;creditAccountId:string;accounts:Account[]}|null>(null);
  const purchase=kind==="purchase-receipt"||kind==="purchase-return";
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
      const data=await response.json();setEntry(data.entry);setPurchaseSetup(data.purchaseSetup??null);
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
        ...(kind === "payroll" && hasDeductions ? {deductionAccountId:form.get("deductionAccountId")} : {}),
      })});const data=await response.json();
      if (!response.ok) {setMessage(data.error??t("Posting failed","تعذر الترحيل"));return;}
      setEntry(data.entry);setMessage(t("Ledger journal posted","تم ترحيل القيد إلى دفتر الأستاذ"));
    } catch {setMessage(t("Connection failed. Recheck the journal before retrying.","فشل الاتصال. تحقق من القيد قبل إعادة المحاولة."));setLoaded(false);}
    finally {setBusy(false);}
  }
  const hasDeductions=Boolean(deductions && /[1-9]/.test(deductions));
  const debitTypes=kind==="purchase-receipt"?["ASSET","EXPENSE"]:kind==="purchase-return"?["LIABILITY"]:kind === "payroll-payment"?["LIABILITY"]:["expense","payroll"].includes(kind)?["EXPENSE"]:["ASSET"];
  const creditTypes=kind==="purchase-receipt"?["LIABILITY"]:kind==="purchase-return"?["ASSET","EXPENSE"]:kind === "payroll-payment"?["ASSET"]:kind === "payroll"?["LIABILITY"]:kind === "expense"?["ASSET","LIABILITY"]:["REVENUE"];
  const displayedAccounts=[...new Map([...accounts,...(purchaseSetup?.accounts??[])].map(a=>[a.id,a])).values()];
  return <div className="document-posting">
    <button type="button" disabled={busy} onClick={()=>open?setOpen(false):void inspect()}>{kind === "payroll-payment" ? t("Payment settlement journal","قيد تسوية صرف الراتب") : kind === "payroll" ? t("Payroll accrual journal","قيد استحقاق الراتب") : t("Ledger posting","الترحيل المحاسبي")}</button>
    {open&&<div>
      <p>{t("Posts this document once as a balanced journal. Select the correct accounts; this does not collect or send money.","يُرحّل هذا المستند مرة واحدة بقيد متوازن. اختر الحسابات المناسبة؛ لا تُحصّل أو تُحوّل أموالاً من هنا.")}</p>
      {purchase&&<p>{t("Amount uses saved purchase-order unit prices and this document's quantities, in company currency. No tax, freight, currency conversion or money transfer is included.","تُحسب القيمة من أسعار بنود أمر الشراء المحفوظة وكميات هذا المستند بعملة الشركة. لا يتضمن القيد الضرائب أو الشحن أو تحويل العملة أو تحويل أموال.")}</p>}
      {kind==="purchase-receipt"&&<p>{t("Debit the purchase asset or expense account and credit supplier payable. Returns post separate credits to those same accounts. Reverse active return credits before reversing this receipt journal.","اختر حساب أصل المشتريات أو المصروف مدينًا، وحساب مستحق المورد دائنًا. تُرحّل المرتجعات بقيود منفصلة على الحسابات نفسها. اعكس قيود المرتجعات السارية قبل عكس قيد الاستلام.")}</p>}
      {kind==="purchase-return"&&<p>{t("An active original receipt journal is required. Debit its supplier payable and credit its original purchase account. This records the return credit; cash refunds and supplier payments require separate settlement.","يلزم قيد استلام أصلي سارٍ. حساب مستحق المورد مدين وحساب المشتريات الأصلي دائن. يسجّل هذا إشعار المرتجع محاسبيًا؛ الاسترداد النقدي وسداد المورد يحتاجان تسوية منفصلة.")}</p>}
      {purchaseSetup&&<p><a href={`/accounting/ledger/journals/${purchaseSetup.entry.id}`}>{t("Original receipt journal","قيد الاستلام الأصلي")} · {purchaseSetup.entry.number}</a></p>}
      {loaded&&!entry&&eligible&&!canPost&&<p>{t("Posting permission is required to create a journal.","يلزم إذن الترحيل لإنشاء القيد.")}</p>}
      {loaded&&!entry&&kind==="purchase-return"&&!purchaseSetup&&<p>{t("Post the original receipt first, then check again.","رحّل الاستلام الأصلي أولًا ثم أعد التحقق.")}</p>}
      {kind === "payroll" && <p>{t("Accrual: debit gross salary and allowances; credit net payroll payable and a separate deduction account. Choose a liability for amounts owed to others, or an expense offset for salary reductions. After recording payment, post its separate settlement journal.","قيد الاستحقاق: إجمالي الأساسي والبدلات مدين، وصافي الرواتب المستحقة والخصومات دائن. اختر للخصومات حساب التزام للمبالغ المستحقة للغير أو حساب مصروف مقابل لتخفيضات الراتب. بعد تسجيل الصرف، رحّل قيد تسويته المنفصل.")}</p>}
      {kind === "payroll-payment" && <p>{t("Debit the same net-pay liability selected in the active accrual and credit the cash/bank asset used for the recorded payment. Reverse this payment journal before reversing the accrual. No money is transferred; deduction liabilities remain for separate settlement.","اختر مديناً نفس حساب صافي الرواتب المستحقة في قيد الاستحقاق الساري، ودائناً حساب النقد أو البنك المستخدم للصرف المسجّل. اعكس قيد الصرف قبل عكس الاستحقاق. لا يُحوّل هذا الإجراء أموالاً؛ تبقى التزامات الخصومات لتسوية منفصلة.")}</p>}
      {message&&<p role="status">{message}</p>}
      {busy&&<p role="status">{t("Working…","جاري التنفيذ…")}</p>}
      {!loaded&&!busy&&<button type="button" onClick={()=>void inspect()}>{t("Check again","إعادة التحقق")}</button>}
      {loaded&&!entry&&!eligible&&<p>{t("No linked ledger journal.","لا يوجد قيد محاسبي مرتبط.")}</p>}
      {entry?<p><a href={`/accounting/ledger/journals/${entry.id}`}>{t("View journal","عرض القيد")} · {entry.number}</a>
        {entry.reversal&&<> · <a href={`/accounting/ledger/journals/${entry.reversal.id}`}>{t("Reversed","معكوس")} · {entry.reversal.number}</a></>}</p>:
        loaded&&eligible&&canPost&&(kind!=="purchase-return"||purchaseSetup)&&<form onSubmit={event=>void post(event)}>
          <strong>{amount} {currency}</strong>
          <label>{t("Journal date","تاريخ القيد")} <input name="entryDate" type="date" required disabled={busy}/></label>
          <label>{t("Debit account","الحساب المدين")} <select name="debitAccountId" required disabled={busy} defaultValue={purchaseSetup?.debitAccountId??""}>
            <option value="">{t("Select account","اختر الحساب")}</option>
            {displayedAccounts.filter(a=>debitTypes.includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
          <label>{kind === "payroll" ? t("Net payroll payable account","حساب صافي الرواتب المستحقة") : t("Credit account","الحساب الدائن")} <select name="creditAccountId" required disabled={busy} defaultValue={purchaseSetup?.creditAccountId??""}>
            <option value="">{t("Select account","اختر الحساب")}</option>
            {displayedAccounts.filter(a=>creditTypes.includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>
          {kind === "payroll" && hasDeductions && <label>{t("Deduction account","حساب الخصومات")} · {deductions} {currency} <select name="deductionAccountId" required disabled={busy} defaultValue="">
            <option value="">{t("Select account","اختر الحساب")}</option>
            {displayedAccounts.filter(a=>["LIABILITY","EXPENSE"].includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </select></label>}
          {nextPage!==null&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await accountPage(nextPage);}catch{setMessage(t("Could not load more accounts","تعذر تحميل المزيد من الحسابات"));}finally{setBusy(false);}}}>{t("More accounts","المزيد من الحسابات")}</button>}
          <a href="/accounting/ledger#ledger-accounts">{t("Set up chart of accounts","إعداد دليل الحسابات")}</a>
          <button disabled={busy}>{t("Post balanced journal","ترحيل القيد المتوازن")}</button>
        </form>}
    </div>}
  </div>;
}

