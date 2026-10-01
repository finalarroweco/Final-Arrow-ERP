"use client";
import { useCallback, useEffect, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
type Rights = { canCreate: boolean; canApprove: boolean; canPay: boolean; canVoid: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Employee = { id: string; fullName: string; code: string; branchId: string | null };
type Entry = { id: string; employeeName: string; employeeCode: string; branchId: string | null; period: string;
  baseSalary: string; allowances: string; deductions: string; netPay: string; currency: string;
  status: "DRAFT" | "APPROVED" | "PAID" | "VOID"; paymentReference: string | null; voidReason: string | null; note: string | null };
export function PayrollWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0); const [month, setMonth] = useState("");
  const [filters, setFilters] = useState({ q: "", status: "", branchId: "" });
  const [entries, setEntries] = useState<Entry[]>([]); const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeePage, setEmployeePage] = useState<number | null>(null);
  const [page, setPage] = useState(0); const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const option = options[selected];
  const load = useCallback(async (number = 0) => {
    if (!option) return;
    try {
      const response = await fetch(`/api/payroll?${new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number), ...(month ? { period: month } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) })}`);
      const data = await response.json(); if (!response.ok) { setMessage(data.error); return; }
      setEntries(data.entries); setPage(number); setNext(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [option, month, filters, t]);
  const loadEmployees = useCallback(async (number = 0) => {
    if (!option || !(option.companyRights.canCreate || option.branches.some((branch) => branch.canCreate))) return;
    try {
      const response = await fetch(`/api/employees?${new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) })}`);
      const data = await response.json(); if (!response.ok) { setMessage(data.error); return; }
      setEmployees((old) => number === 0 ? data.employees : [...old, ...data.employees]); setEmployeePage(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [option, t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); setMessage(response.ok ? t("Payroll saved", "تم حفظ سجل الراتب") : data.error);
      if (response.ok) await load(method === "POST" ? 0 : page);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>{t("No accessible payroll records.", "لا توجد سجلات رواتب متاحة.")}</p></section>;
  const eligible = employees.filter((employee) => employee.branchId ? option.branches.find((branch) => branch.id === employee.branchId)?.canCreate : option.companyRights.canCreate);
  const amountField = (name: string, en: string, ar: string) => <label>{t(en, ar)} <input name={name} type="number" min={0} max={9999999999} step="0.001" defaultValue={name === "baseSalary" ? undefined : "0"} required /></label>;
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} disabled={busy} onChange={(event) => { setSelected(Number(event.target.value)); setFilters({ q: "", status: "", branchId: "" }); setEntries([]); setEmployees([]); setEmployeePage(null); setMessage(""); }}>
      {options.map((scope, index) => <option key={scope.companyId} value={index}>{scope.label}</option>)}</select></label>
    <p>{t("Amounts are entered manually in the company currency. Taxes, social insurance and attendance deductions are not calculated automatically. Recording payment here does not transfer money.",
      "تُدخل المبالغ يدوياً بعملة الشركة. الضرائب والتأمينات وخصومات الحضور لا تُحسب تلقائياً. تسجيل الصرف هنا لا يحوّل الأموال.")}</p>
    {(option.companyRights.canCreate || option.branches.some((branch) => branch.canCreate)) && <form action={(form) => mutate("/api/payroll", "POST", {
      tenantId: option.tenantId, companyId: option.companyId, employeeId: form.get("employeeId"), period: form.get("period"),
      baseSalary: form.get("baseSalary"), allowances: form.get("allowances"), deductions: form.get("deductions"), note: form.get("note") || null })}>
      <h2>{t("New payroll draft", "مسودة راتب جديدة")} · {option.currency}</h2>
      <label>{t("Employee", "الموظف")} <select name="employeeId" defaultValue="" required><option value="">{t("Select employee", "اختر موظفاً")}</option>
        {eligible.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}</select></label>
      {employeePage !== null && <button type="button" disabled={busy} onClick={() => void loadEmployees(employeePage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
      <label>{t("Month", "الشهر")} <input name="period" type="month" required /></label>
      {amountField("baseSalary", "Base salary", "الراتب الأساسي")}{amountField("allowances", "Allowances", "البدلات")}{amountField("deductions", "Deductions", "الخصومات")}
      <label>{t("Note", "ملاحظة")} <input name="note" maxLength={1000} /></label><button disabled={busy || !eligible.length}>{t("Create draft", "إنشاء المسودة")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Payroll register", "سجل الرواتب")}</h2>
    <form key={option.companyId} action={(form) => { setFilters({ q: String(form.get("q") || ""), status: String(form.get("status") || ""), branchId: String(form.get("branchId") || "") }); setEntries([]); }}>
      <label>{t("Employee name or code", "اسم الموظف أو رمزه")} <input name="q" maxLength={120} /></label>
      <label>{t("Status", "الحالة")} <select name="status"><option value="">{t("All statuses", "كل الحالات")}</option>
        <option value="DRAFT">{t("Draft", "مسودة")}</option><option value="APPROVED">{t("Approved", "معتمد")}</option>
        <option value="PAID">{t("Paid", "مصروف")}</option><option value="VOID">{t("Void", "ملغى")}</option></select></label>
      <label>{t("Branch", "الفرع")} <select name="branchId"><option value="">{t("All accessible branches", "كل الفروع المتاحة")}</option>
        {option.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <button disabled={busy}>{t("Apply filters", "تطبيق الفلاتر")}</button>
      <button type="reset" disabled={busy} onClick={() => { setFilters({ q: "", status: "", branchId: "" }); setEntries([]); }}>{t("Reset filters", "إعادة ضبط الفلاتر")}</button>
    </form>
    <label>{t("Filter by month", "تصفية حسب الشهر")} <input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setEntries([]); }} /></label>
    <button disabled={busy} onClick={() => { setMonth(""); setEntries([]); }}>{t("All months", "كل الأشهر")}</button>
    {entries.length === 0 && <p>{t("No entries on this page.", "لا توجد سجلات في هذه الصفحة.")}</p>}
    {entries.map((entry) => {
      const rights = entry.branchId ? option.branches.find((branch) => branch.id === entry.branchId) : option.companyRights;
      return <article className="card" key={entry.id}><strong>{entry.employeeName}</strong> · {entry.employeeCode}
        <p><a href={`/hr/payroll/${entry.id}`}>{t("View / print statement", "عرض / طباعة الكشف")}</a></p>
        <p>{entry.period.slice(0, 7)} · {t(entry.status, { DRAFT: "مسودة", APPROVED: "معتمد", PAID: "مصروف", VOID: "ملغى" }[entry.status])}</p>
        <p>{t("Base", "الأساسي")}: {entry.baseSalary} · {t("Allowances", "البدلات")}: {entry.allowances} · {t("Deductions", "الخصومات")}: {entry.deductions}</p>
        <p><strong>{t("Net pay", "صافي الراتب")}: {entry.netPay} {entry.currency}</strong></p>
        {entry.note && <p>{entry.note}</p>}{entry.paymentReference && <p>{t("Payment reference", "مرجع الصرف")}: {entry.paymentReference}</p>}{entry.voidReason && <p>{entry.voidReason}</p>}
        {rights?.canApprove && entry.status === "DRAFT" && <button disabled={busy} onClick={() => void mutate(`/api/payroll/${entry.id}`, "PATCH", { tenantId: option.tenantId, action: "approve" })}>{t("Approve", "اعتماد")}</button>}
        {rights?.canPay && entry.status === "APPROVED" && <form action={(form) => mutate(`/api/payroll/${entry.id}`, "PATCH", { tenantId: option.tenantId, action: "pay", reference: form.get("reference") })}>
          <label>{t("Payment reference", "مرجع الصرف")} <input name="reference" minLength={3} maxLength={200} required /></label><button disabled={busy}>{t("Record payment", "تسجيل الصرف")}</button></form>}
        {rights?.canVoid && ["DRAFT", "APPROVED"].includes(entry.status) && <details><summary>{t("Void payroll", "إلغاء سجل الراتب")}</summary><form action={(form) => mutate(`/api/payroll/${entry.id}`, "PATCH", { tenantId: option.tenantId, action: "void", reason: form.get("reason") })}>
          <label>{t("Reason", "السبب")} <input name="reason" minLength={3} maxLength={500} required /></label><button disabled={busy}>{t("Void", "إلغاء")}</button></form></details>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(page - 1)}>{t("Previous", "السابق")}</button>}{next !== null && <button disabled={busy} onClick={() => void load(next)}>{t("Next", "التالي")}</button>}
  </section>;
}
