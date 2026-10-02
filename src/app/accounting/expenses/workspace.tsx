"use client";

import {FinancialReport} from "../financial-report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canPost: boolean; canVoid: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Expense = { id: string; number: string; description: string; category: string; amount: string;
  currency: string; expenseDate: string; status: "DRAFT" | "POSTED" | "VOID";
  branchId: string | null; voidReason: string | null };

export function ExpensesWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [reportVersion,setReportVersion]=useState(0);
  const [selected, setSelected] = useState(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/expenses?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load expenses", "تعذر تحميل المصاريف")); return; }
    setExpenses(data.expenses); setPage(number); setNextPage(data.nextPage);
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, pageNumber = 0) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) {setReportVersion(value=>value+1);await load(selected, pageNumber);}
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const createBranches = scope.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>{t("Company", "الشركة") } <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setExpenses([]); setMessage(""); }}>
      {options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}
    </select></label>
    {(scope.companyRights.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/expenses", "POST",
      { tenantId: scope.tenantId, companyId: scope.companyId, branchId: form.get("branchId") || null,
        number: form.get("number"), description: form.get("description"), category: form.get("category"),
        amount: form.get("amount"), expenseDate: form.get("expenseDate") }, t("Expense draft created", "تم إنشاء مسودة المصروف"))}>
      <h2>{t("New expense draft", "مسودة مصروف جديدة")}</h2>
      <label>{t("Number", "الرقم") } <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="EXP-001" /></label>
      <label>{t("Description", "الوصف") } <input name="description" required minLength={2} maxLength={300} /></label>
      <label>{t("Category", "التصنيف") } <input name="category" required minLength={2} maxLength={80} placeholder={t("Travel", "سفر")} /></label>
      <label>{t("Amount", "المبلغ")} ({scope.currency}) <input name="amount" required type="number" min="0.001" max="999999999999999.999" step="0.001" /></label>
      <label>{t("Expense date", "تاريخ المصروف") } <input name="expenseDate" required type="date" /></label>
      <label>{t("Branch", "الفرع") } <select name="branchId">
        {scope.companyRights.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>{t("Create draft", "إنشاء مسودة")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <FinancialReport key={`${scope.companyId}:${reportVersion}`} kind="expenses" scope={scope} locale={locale}/>
    <h2>{t("Expenses", "المصاريف")}</h2>
    {expenses.length === 0 && <p>{t("No expenses on this page.", "لا توجد مصاريف في هذه الصفحة.")}</p>}
    {expenses.map((expense) => {
      const rights = expense.branchId ? scope.branches.find((branch) => branch.id === expense.branchId) : scope.companyRights;
      return <article key={expense.id} className="card"><strong>{expense.number} · {expense.description}</strong>
        <p>{expense.category} · {expense.amount} {expense.currency} · {expense.expenseDate.slice(0, 10)} · {t(expense.status, ({ DRAFT: "مسودة", POSTED: "مرحّل", VOID: "ملغى" })[expense.status])} · {expense.branchId ? scope.branches.find((branch) => branch.id === expense.branchId)?.name : t("Company wide", "على مستوى الشركة")}</p>
        {expense.voidReason && <p>{t("Void reason:", "سبب الإلغاء:")} {expense.voidReason}</p>}
        {rights?.canPost && expense.status === "DRAFT" && <button disabled={busy}
          onClick={() => void mutate(`/api/expenses/${expense.id}/status`, "PATCH",
            { tenantId: scope.tenantId, action: "post" }, t("Expense posted", "تم ترحيل المصروف"), page)}>{t("Post expense", "ترحيل المصروف")}</button>}
        {rights?.canVoid && expense.status !== "VOID" && <form action={(form) => mutate(
          `/api/expenses/${expense.id}/status`, "PATCH",
          { tenantId: scope.tenantId, action: "void", reason: form.get("reason") },
          t("Expense voided", "تم إلغاء المصروف"), page)}>
          <label>{t("Void reason", "سبب الإلغاء") } <input name="reason" required minLength={3} maxLength={300} /></label>
          <button disabled={busy}>{t("Void expense", "إلغاء المصروف")}</button>
        </form>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
