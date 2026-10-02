"use client";
import { useCallback, useEffect, useState } from "react";
import { translate, type Locale } from "@/lib/locale";
import {TimeReport} from "./report";
type Project = { id: string; tenantId: string; companyId: string; branchId: string | null; status: string };
type Employee = { id: string; code: string; fullName: string; branchId: string | null };
type Entry = { id: string; workDate: string; minutes: number; description: string; employeeName: string | null; employeeCode: string | null; voidedAt: string | null; voidReason: string | null };
export function TimeWorkspace({ project, canManage, locale }: { project: Project; canManage: boolean; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [reportVersion,setReportVersion]=useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeePage, setEmployeePage] = useState<number | null>(null);
  const [page, setPage] = useState(0); const [next, setNext] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(0); const [count, setCount] = useState(0);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async (number = 0) => {
    try {
      const response = await fetch(`/api/projects/${project.id}/time?${new URLSearchParams({ tenantId: project.tenantId, page: String(number) })}`);
      const data = await response.json(); if (!response.ok) { setMessage(data.error); return; }
      setEntries(data.entries); setMinutes(data.totalMinutes); setCount(data.count); setPage(number); setNext(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [project, t]);
  const loadEmployees = useCallback(async (number = 0) => {
    if (!canManage) return;
    try {
      const response = await fetch(`/api/employees?${new URLSearchParams({ tenantId: project.tenantId, companyId: project.companyId, page: String(number) })}`);
      const data = await response.json(); if (!response.ok) { setMessage(data.error); return; }
      setEmployees((old) => number === 0 ? data.employees : [...old, ...data.employees]); setEmployeePage(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [project, canManage, t]);
  useEffect(() => { void load(); void loadEmployees(); }, [load, loadEmployees]);
  async function save(form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/time`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: project.tenantId, employeeId: form.get("employeeId"), workDate: form.get("workDate"),
          minutes: Number(form.get("minutes")), description: form.get("description") }) });
      const data = await response.json(); setMessage(response.ok ? t("Time recorded", "تم تسجيل الوقت") : data.error);
      if (response.ok) {setReportVersion(value=>value+1);await load();}
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  async function voidEntry(entryId: string, form: FormData) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/projects/${project.id}/time`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: project.tenantId, entryId, reason: form.get("reason") }) });
      const data = await response.json(); setMessage(response.ok ? t("Entry voided", "تم إلغاء السجل") : data.error);
      if (response.ok) {setReportVersion(value=>value+1);await load(page);}
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  const eligible = employees.filter((employee) => !project.branchId || !employee.branchId || employee.branchId === project.branchId);
  return <section className="panel"><p>{t("Recorded hours", "الساعات المسجلة")}: {(minutes / 60).toFixed(2)} · {t("Entries", "السجلات")}: {count}</p>
    {canManage && project.status === "ACTIVE" && <form action={save}><h2>{t("New time entry", "سجل وقت جديد")}</h2>
      <label>{t("Employee", "الموظف")} <select name="employeeId" required defaultValue=""><option value="">{t("Select employee", "اختر موظفاً")}</option>
        {eligible.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}</select></label>
      {employeePage !== null && <button type="button" disabled={busy} onClick={() => void loadEmployees(employeePage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
      <label>{t("Work date", "يوم العمل")} <input name="workDate" type="date" required /></label>
      <label>{t("Duration in minutes", "المدة بالدقائق")} <input name="minutes" type="number" min={1} max={1440} step={1} required /></label>
      <label>{t("Work description", "وصف العمل")} <input name="description" minLength={3} maxLength={1000} required /></label>
      <button disabled={busy || !eligible.length}>{t("Record time", "تسجيل الوقت")}</button></form>}
    {message && <p role="status">{message}</p>}
    <TimeReport key={reportVersion} projectId={project.id} tenantId={project.tenantId} locale={locale}/>
    <h2>{t("Time entries", "سجلات الوقت")}</h2>
    {entries.length === 0 && <p>{t("No entries on this page.", "لا توجد سجلات في هذه الصفحة.")}</p>}
    {entries.map((entry) => <article key={entry.id} className="card"><strong>{entry.employeeName ?? t("Employee details restricted", "بيانات الموظف مقيّدة")}</strong> {entry.employeeCode}
      <p>{entry.workDate.slice(0, 10)} · {(entry.minutes / 60).toFixed(2)} {t("hours", "ساعة")}</p><p>{entry.description}</p>
      {entry.voidedAt && <p>{t("Voided", "ملغى")} · {entry.voidReason}</p>}
      {canManage && !entry.voidedAt && ["PLANNED", "ACTIVE", "ON_HOLD"].includes(project.status) && <details><summary>{t("Correct entry", "تصحيح السجل")}</summary>
        <p>{t("Void the incorrect entry and create a replacement. The original stays in the history.", "ألغِ السجل الخاطئ وأضف البديل. يبقى السجل الأصلي في التاريخ.")}</p>
        <form action={(form) => voidEntry(entry.id, form)}><label>{t("Reason", "السبب")} <input name="reason" required minLength={3} maxLength={500} /></label>
          <button disabled={busy}>{t("Void entry", "إلغاء السجل")}</button></form></details>}
      </article>)}
    {page > 0 && <button disabled={busy} onClick={() => void load(page - 1)}>{t("Previous", "السابق")}</button>}
    {next !== null && <button disabled={busy} onClick={() => void load(next)}>{t("Next", "التالي")}</button>}
  </section>;
}
