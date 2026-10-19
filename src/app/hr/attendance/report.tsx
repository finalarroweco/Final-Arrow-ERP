"use client";

import { useState } from "react";
import { translate, type Locale } from "@/lib/locale";

type Option = { tenantId: string; companyId: string; branches: { id: string; name: string }[] };
type Employee = { id: string; code: string; fullName: string; branchId: string | null };
type Row = { date: string; employeeCode: string; employeeName: string; branch: string;
  start: string; end: string; minutes: number | null; note: string };
type Result = { rows: Row[]; summary: { entries: number; open: number; completedMinutes: number } };

export function AttendanceReport({ scope, employees, locale }: { scope: Option; employees: Employee[]; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [branchId, setBranchId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const query = (format: "json" | "csv") => new URLSearchParams({ tenantId: scope.tenantId,
    companyId: scope.companyId, from, to, ...(branchId ? { branchId } : {}),
    ...(employeeId ? { employeeId } : {}), format });
  async function run(format: "json" | "csv") {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/attendance/report?${query(format)}`, { cache: "no-store" });
      if (!response.ok) { const data = await response.json(); setMessage(data.error ?? t("Report failed", "تعذر إعداد التقرير")); return; }
      if (format === "json") setResult(await response.json());
      else {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = url;
        link.download = `attendance-${from}-to-${to}.csv`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  return <section className="panel"><h2>{t("Attendance report", "تقرير الحضور")}</h2>
    <p>{t("Choose up to 31 days. Hours reflect completed manual entries only; missing days are not treated as absence.",
      "اختر مدة لا تتجاوز 31 يوماً. الساعات تشمل السجلات اليدوية المكتملة فقط، ولا تُحسب الأيام غير المسجلة غياباً.")}</p>
    <form onSubmit={(event) => { event.preventDefault(); void run("json"); }}>
      <label>{t("From", "من")} <input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setResult(null); }} required /></label>
      <label>{t("To", "إلى")} <input type="date" value={to} onChange={(event) => { setTo(event.target.value); setResult(null); }} required /></label>
      <label>{t("Branch", "الفرع")} <select value={branchId} onChange={(event) => { setBranchId(event.target.value); setEmployeeId(""); setResult(null); }}>
        <option value="">{t("All visible branches", "كل الفروع المتاحة")}</option>
        {scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label>{t("Employee", "الموظف")} <select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setResult(null); }}>
        <option value="">{t("All employees", "كل الموظفين")}</option>
        {employees.filter((employee) => !branchId || employee.branchId === branchId).map((employee) =>
          <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
      </select></label>
      <button disabled={busy}>{t("Show report", "عرض التقرير")}</button>
      <button type="button" disabled={busy || !from || !to} onClick={() => void run("csv")}>{t("Download CSV", "تنزيل CSV")}</button>
    </form>
    {message && <p role="status">{message}</p>}
    {result && <><p>{t("Entries", "السجلات")}: {result.summary.entries} · {t("Open", "مفتوحة")}: {result.summary.open} · {t("Completed hours", "الساعات المكتملة")}: {(result.summary.completedMinutes / 60).toFixed(2)}</p>
      <div className="tablewrap"><table><thead><tr><th>{t("Date", "التاريخ")}</th><th>{t("Employee", "الموظف")}</th><th>{t("Branch", "الفرع")}</th><th>{t("Start", "الدخول")}</th><th>{t("End", "الخروج")}</th><th>{t("Hours", "الساعات")}</th></tr></thead>
        <tbody>{result.rows.slice(0, 100).map((row, index) => <tr key={`${row.date}-${row.employeeCode}-${index}`}>
          <td>{row.date}</td><td>{row.employeeName} · {row.employeeCode}</td><td>{row.branch || t("Company wide", "على مستوى الشركة")}</td>
          <td>{row.start}</td><td>{row.end || t("Open", "مفتوح")}</td><td>{row.minutes === null ? "—" : (row.minutes / 60).toFixed(2)}</td></tr>)}</tbody></table></div>
      {result.rows.length > 100 && <p>{t("Showing first 100 entries. Download CSV for all filtered entries.", "أول 100 سجل معروضة. نزّل CSV لكل السجلات المصفّاة.")}</p>}</>}
  </section>;
}
