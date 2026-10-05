"use client";
import {PeriodLock} from "./period-lock";
import {BalanceSheet} from "./balance-sheet";
import {IncomeStatement} from "./income-statement";
import {AccountStatement} from "./statement";
import { useCallback, useEffect, useRef, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
type Option = { tenantId: string; companyId: string; label: string; currency: string; canManageAccounts: boolean; canPost: boolean; branches: { id: string; name: string; canPost: boolean }[] };
type Account = { id: string; code: string; name: string; type: string };
type Entry = { id: string; number: string; entryDate: string; description: string; branchId: string | null; total: string; currency: string; reversalOf: string | null; reversal: { number: string } | null; lines: { id: string; account: { code: string; name: string }; debit: string; credit: string }[] };
type Row = { accountId: string; code: string; name: string; currency: string; debit: string; credit: string; debitBalance: string; creditBalance: string };
export function LedgerWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale,en,ar),[locale]);
  const [selected,setSelected] = useState(0); const option = options[selected];
  const [accounts,setAccounts] = useState<Account[]>([]); const [accountNext,setAccountNext] = useState<number|null>(null);
  const [entries,setEntries] = useState<Entry[]>([]); const [page,setPage] = useState(0); const [next,setNext] = useState<number|null>(null);
  const [lineCount,setLineCount] = useState(2); const [filters,setFilters] = useState({ from: "", to: "", branchId: "" });
  const [reportQuery,setReportQuery]=useState("");
  const [totals,setTotals]=useState<{currency:string;debit:string;credit:string;debitBalance:string;creditBalance:string;balanced:boolean}[]>([]);
  const [rows,setRows] = useState<Row[]>([]); const [report,setReport] = useState(false);
  const [lockedThrough,setLockedThrough]=useState<string|null>(null);
  const periodChanged=useCallback((date:string|null)=>setLockedThrough(date),[]);
  const journalRequest = useRef(0); const accountRequest = useRef(0);
  const [statementVersion,setStatementVersion]=useState(0);
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState("");
  const query = useCallback((extra: Record<string,string> = {}) => new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, ...Object.fromEntries(Object.entries(filters).filter(([,value]) => value)), ...extra }),[option,filters]);
  const load = useCallback(async (number = 0) => {
    if (!option) return;
    const request = ++journalRequest.current;
    try { const response = await fetch(`/api/ledger/journals?${query({page: String(number)})}`); const data = await response.json(); if (request !== journalRequest.current) return; if (!response.ok) { setMessage(data.error); return; } setEntries(data.entries); setPage(number); setNext(data.nextPage); }
    catch { if (request !== journalRequest.current) return; setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  },[option,query,t]);
  const loadAccounts = useCallback(async (number = 0) => {
    if (!option) return;
    const request = ++accountRequest.current;
    try { const response = await fetch(`/api/ledger/accounts?${new URLSearchParams({tenantId: option.tenantId, companyId: option.companyId, page: String(number)})}`); const data = await response.json(); if (request !== accountRequest.current) return; if (!response.ok) { setMessage(data.error); return; } setAccounts((old) => number === 0 ? data.accounts : [...old,...data.accounts]); setAccountNext(data.nextPage); }
    catch { if (request !== accountRequest.current) return; setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  },[option,t]);
  useEffect(() => { setRows([]); setReport(false); void load(); },[load]);
  useEffect(() => { void loadAccounts(); },[loadAccounts]);
  async function save(url: string, body: object) {
    setBusy(true); setMessage("");
    try { const response = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}); const data = await response.json(); setMessage(response.ok ? t("Saved", "تم الحفظ") : data.error); if(response.ok) { setStatementVersion(n=>n+1); setRows([]); setReport(false); await load(); if(url.endsWith("accounts")) await loadAccounts(); } }
    catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if(!option) return <section className="panel"><p>{t("No accessible ledger.", "لا يوجد دفتر أستاذ متاح.")}</p></section>;
  const types: Record<string,string> = {ASSET:"أصول",LIABILITY:"التزامات",EQUITY:"حقوق ملكية",REVENUE:"إيرادات",EXPENSE:"مصروفات"};
  const firstOpenDate=lockedThrough?new Date(Date.parse(`${lockedThrough}T00:00:00Z`)+86400000).toISOString().slice(0,10):undefined;
  const createBranches = option.branches.filter((branch) => branch.canPost);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select disabled={busy} value={selected} onChange={(event) => { journalRequest.current++; accountRequest.current++; setLockedThrough(null); setSelected(Number(event.target.value)); setFilters({from:"",to:"",branchId:""}); setAccounts([]); setEntries([]); setMessage(""); }}>
      {options.map((scope,index) => <option key={scope.companyId} value={index}>{scope.label}</option>)}</select></label>
    <p>{t("Manual journals are posted immediately and cannot be edited. Corrections create a dated reversal. Issued invoices, approved expenses and paid POS orders can be posted from their registers after selecting accounts. Approved payroll can post gross, net payable and deductions from the payroll register. Payment settlement remains separate.", "تُرحّل القيود اليدوية مباشرة ولا يمكن تعديلها. التصحيح ينشئ قيداً عكسياً مؤرخاً. يمكن ترحيل الفواتير المصدرة والمصاريف المعتمدة وطلبات نقاط البيع المدفوعة من سجلاتها بعد اختيار الحسابات. يمكن ترحيل إجمالي الرواتب المعتمدة وصافي المستحق والخصومات من سجل الرواتب. تبقى تسوية الصرف منفصلة.")}</p>
    {message && <p role="status">{message}</p>}
    <nav aria-label={t("Ledger sections", "أقسام دفتر الأستاذ")} style={{display:"flex",gap:"1rem",flexWrap:"wrap",marginBlock:"1rem"}}>
      <a href="#ledger-period">{t("Period lock", "قفل الفترة")}</a>
      <a href="#ledger-accounts">{t("Chart of accounts", "دليل الحسابات")}</a>
      {(option.canPost || option.branches.some(branch=>branch.canPost)) && <a href="#ledger-post">{t("Post journal", "ترحيل القيد")}</a>}
      <a href="#ledger-balance">{t("Balance sheet", "المركز المالي")}</a>
      <a href="#ledger-income">{t("Income statement", "قائمة الدخل")}</a>
      <a href="#ledger-statement">{t("Account statement", "كشف الحساب")}</a>
      <a href="#ledger-journals">{t("Journals and trial balance", "القيود وميزان المراجعة")}</a>
    </nav>
    <div className="ledger-period-slot"><PeriodLock scope={option} locale={locale} onChange={periodChanged}/></div>
    <h2 id="ledger-accounts">{t("Chart of accounts", "دليل الحسابات")}</h2>
    {option.canManageAccounts && <form action={(form) => save("/api/ledger/accounts",{tenantId:option.tenantId,companyId:option.companyId,code:form.get("code"),name:form.get("name"),type:form.get("type")})}>
      <label>{t("Code", "الرمز")} <input name="code" required pattern="[A-Z0-9-]{2,30}" /></label><label>{t("Name", "الاسم")} <input name="name" required minLength={2} maxLength={200} /></label>
      <label>{t("Type", "النوع")} <select name="type">{Object.entries(types).map(([type,ar]) => <option key={type} value={type}>{t(type,ar)}</option>)}</select></label><button disabled={busy}>{t("Create account", "إنشاء حساب")}</button></form>}
    {accounts.map((account) => <p key={account.id}>{account.code} · {account.name} · {t(account.type,types[account.type])}</p>)}
    {accountNext !== null && <button disabled={busy} onClick={() => void loadAccounts(accountNext)}>{t("Load more accounts", "تحميل المزيد من الحسابات")}</button>}
    {(option.canPost || createBranches.length > 0) && <form key={option.companyId} action={(form) => save("/api/ledger/journals",{tenantId:option.tenantId,companyId:option.companyId,branchId:form.get("branchId") || null,number:form.get("number"),entryDate:form.get("entryDate"),description:form.get("description"),lines:Array.from({length:lineCount},(_,i) => ({accountId:form.get(`account-${i}`),debit:form.get(`debit-${i}`),credit:form.get(`credit-${i}`)}))})}>
      <h2 id="ledger-post">{t("Post a manual journal", "ترحيل قيد يدوي")} · {option.currency}</h2>
      <label>{t("Number", "الرقم")} <input name="number" required pattern="[A-Z0-9-]{2,30}" /></label><label>{t("Date", "التاريخ")} <input name="entryDate" type="date" min={firstOpenDate} required /></label>
      <label>{t("Description", "الوصف")} <input name="description" required minLength={3} maxLength={500} /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId">{option.canPost && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}{createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      {Array.from({length:lineCount},(_,i) => <fieldset key={i}><legend>{t("Line", "السطر")} {i+1}</legend><label>{t("Account", "الحساب")} <select name={`account-${i}`} required defaultValue=""><option value="">{t("Select account", "اختر الحساب")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
        <label>{t("Debit", "مدين")} <input name={`debit-${i}`} type="number" min={0} max={999999999999} step="0.001" required defaultValue="0" /></label><label>{t("Credit", "دائن")} <input name={`credit-${i}`} type="number" min={0} max={999999999999} step="0.001" required defaultValue="0" /></label></fieldset>)}
      <button type="button" disabled={busy || lineCount >= 100} onClick={() => setLineCount((count) => count+1)}>{t("Add line", "إضافة سطر")}</button><button type="button" disabled={busy || lineCount <= 2} onClick={() => setLineCount((count) => count-1)}>{t("Remove last line", "إزالة آخر سطر")}</button><button disabled={busy || accounts.length === 0}>{t("Post journal", "ترحيل القيد")}</button></form>}
    <div id="ledger-balance"><BalanceSheet key={`balance:${option.companyId}:${statementVersion}`} scope={option} locale={locale}/></div><div id="ledger-income"><IncomeStatement key={`income:${option.companyId}:${statementVersion}`} scope={option} locale={locale}/></div><div id="ledger-statement"><AccountStatement key={`${option.companyId}:${statementVersion}`} scope={option} accounts={accounts} locale={locale}/></div><h2 id="ledger-journals">{t("Journals and trial balance", "القيود وميزان المراجعة")}</h2>
    <form key={`filters-${option.companyId}`} action={(form) => setFilters({from:String(form.get("from") || ""),to:String(form.get("to") || ""),branchId:String(form.get("branchId") || "")})}>
      <label>{t("From", "من")} <input name="from" type="date" /></label><label>{t("To", "إلى")} <input name="to" type="date" /></label><label>{t("Branch", "الفرع")} <select name="branchId"><option value="">{t("All accessible records", "كل السجلات المتاحة")}</option>{option.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button disabled={busy}>{t("Apply", "تطبيق")}</button>
      <button type="reset" disabled={busy} onClick={() => setFilters({from:"",to:"",branchId:""})}>{t("Reset", "إعادة الضبط")}</button></form>
    <button disabled={busy} onClick={async () => {setBusy(true);setReport(false);setMessage("");try {const response=await fetch(`/api/ledger/trial-balance?${query()}`);const data=await response.json();if(response.ok){setRows(data.rows);setTotals(data.summary);setReportQuery(query().toString());setReport(true);}else setMessage(data.error);}catch{setMessage(t("Network request failed", "فشل الاتصال بالشبكة"));}finally{setBusy(false);}}}>{t("View trial balance", "عرض ميزان المراجعة")}</button>
    <p>{t("The report covers the selected dates and accessible branches. A start date limits movements; omit it for balances through the end date. Reversals remain in the report.", "يشمل التقرير التواريخ والفروع المتاحة المحددة. تاريخ البداية يقيّد الحركات؛ اتركه فارغاً لحساب الأرصدة حتى تاريخ النهاية. تبقى القيود العكسية ضمن التقرير.")}</p>
    {report && <div style={{overflowX:"auto"}}><a href={`/api/ledger/trial-balance?${reportQuery}&format=csv`}>{t("Download CSV","تنزيل CSV")}</a>{totals.map(g=><article className="card" key={g.currency}><strong>{g.currency} · {g.balanced?t("Balanced","متوازن"):t("Unbalanced","غير متوازن")}</strong><p>{t("Debit movements","الحركات المدينة")}: {g.debit} · {t("Credit movements","الحركات الدائنة")}: {g.credit}</p><p>{t("Debit balance","رصيد مدين")}: {g.debitBalance} · {t("Credit balance","رصيد دائن")}: {g.creditBalance}</p></article>)}<table><thead><tr>{[t("Account","الحساب"),t("Currency","العملة"),t("Debit movements","الحركات المدينة"),t("Credit movements","الحركات الدائنة"),t("Debit balance","رصيد مدين"),t("Credit balance","رصيد دائن")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={`${row.accountId}:${row.currency}`}><td>{row.code} · {row.name}</td><td>{row.currency}</td><td>{row.debit}</td><td>{row.credit}</td><td>{row.debitBalance}</td><td>{row.creditBalance}</td></tr>)}</tbody></table>{rows.length===0 && <p>{t("No posted movements.", "لا توجد حركات مرحلة.")}</p>}</div>}
    {entries.map((entry) => <article className="card" key={entry.id}><strong>{entry.number} · {entry.description}</strong><p><a href={`/accounting/ledger/journals/${entry.id}`}>{t("View / print journal","عرض / طباعة القيد")}</a></p><p>{entry.entryDate.slice(0,10)} · {entry.total} {entry.currency} · {entry.branchId ? option.branches.find((branch) => branch.id===entry.branchId)?.name : t("Company wide", "على مستوى الشركة")}</p>
      {entry.lines.map((line) => <p key={line.id}>{line.account.code} · {line.account.name} · {t("Debit", "مدين")}: {line.debit} · {t("Credit", "دائن")}: {line.credit}</p>)}
      {entry.reversalOf && <p>{t("Reversal entry", "قيد عكسي")}</p>}{entry.reversal && <p>{t("Reversed by", "تم عكسه بالقيد")}: {entry.reversal.number}</p>}
      {!entry.reversalOf && !entry.reversal && (entry.branchId ? option.branches.find((branch) => branch.id===entry.branchId)?.canPost : option.canPost) && <details><summary>{t("Reverse journal", "عكس القيد")}</summary><form action={(form) => save(`/api/ledger/journals/${entry.id}/reverse`,{tenantId:option.tenantId,number:form.get("number"),entryDate:form.get("entryDate"),reason:form.get("reason")})}>
        <label>{t("Reversal number", "رقم القيد العكسي")} <input name="number" required pattern="[A-Z0-9-]{2,30}" /></label><label>{t("Reversal date", "تاريخ العكس")} <input name="entryDate" type="date" min={firstOpenDate&&firstOpenDate>entry.entryDate.slice(0,10)?firstOpenDate:entry.entryDate.slice(0,10)} required /></label><label>{t("Reason", "السبب")} <input name="reason" required minLength={3} maxLength={500} /></label><button disabled={busy}>{t("Create reversal", "إنشاء قيد عكسي")}</button></form></details>}
    </article>)}
    {entries.length===0 && <p>{t("No journals on this page.", "لا توجد قيود في هذه الصفحة.")}</p>}{page>0 && <button disabled={busy} onClick={() => void load(page-1)}>{t("Previous", "السابق")}</button>}{next!==null && <button disabled={busy} onClick={() => void load(next)}>{t("Next", "التالي")}</button>}
  </section>;
}
