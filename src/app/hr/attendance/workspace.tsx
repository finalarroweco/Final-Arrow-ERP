"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string; companyCanManage: boolean;
  branches: { id: string; name: string; canManage: boolean }[] };
type Employee = { id: string; code: string; fullName: string; branchId: string | null };
type RecordItem = { id: string; employee: { code: string; fullName: string }; branchId: string | null;
  workDate: string; startMinute: number; endMinute: number | null; note: string | null };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: FormDataEntryValue | null) => {
  const [hour, part] = String(value).split(":").map(Number);
  return hour * 60 + part;
};

export function AttendanceWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeNextPage, setEmployeeNextPage] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const option = options[index]; if (!option) return;
    try {
      const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
      const response = await fetch(`/api/attendance?${query}`);
      const data = await response.json();
      if (!response.ok) { setMessage(data.error ?? t("Could not load attendance", "تعذر تحميل الحضور")); return; }
      setRecords(data.records); setPage(number); setNextPage(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [options, t]);
  const loadEmployees = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option || !(option.companyCanManage || option.branches.some((branch) => branch.canManage))) return;
    try {
      const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
      const response = await fetch(`/api/employees?${query}`);
      const data = await response.json();
      if (!response.ok) { setMessage(t("Could not load employees", "تعذر تحميل الموظفين")); return; }
      setEmployees((previous) => number === 0 ? data.employees : [...previous, ...data.employees]);
      setEmployeeNextPage(data.nextPage);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); }
  }, [options, t]);
  useEffect(() => { void load(selected); void loadEmployees(selected); }, [load, loadEmployees, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, number = 0) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await load(selected, number);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>{t("No accessible attendance records.", "لا توجد سجلات حضور متاحة.")}</p></section>;
  const eligible = employees.filter((employee) => employee.branchId
    ? scope.branches.find((branch) => branch.id === employee.branchId)?.canManage : scope.companyCanManage);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setRecords([]); setEmployees([]); setEmployeeNextPage(null); setMessage(""); }}>
      {options.map((option, index) => <option key={`${option.tenantId}-${option.companyId}`} value={index}>{option.label}</option>)}
    </select></label>
    {(scope.companyCanManage || scope.branches.some((branch) => branch.canManage)) && <form action={(form) => mutate("/api/attendance", "POST", {
      tenantId: scope.tenantId, companyId: scope.companyId, employeeId: form.get("employeeId"),
      workDate: form.get("workDate"), startMinute: minute(form.get("start")),
      endMinute: form.get("end") ? minute(form.get("end")) : null,
      note: form.get("note") || null }, t("Attendance recorded", "تم تسجيل الحضور"))}>
      <h2>{t("New manual entry", "سجل يدوي جديد")}</h2>
      <label>{t("Employee", "الموظف")} <select name="employeeId" required defaultValue="">
        <option value="">{t("Select employee", "اختر موظفاً")}</option>
        {eligible.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
      </select></label>
      {employeeNextPage !== null && <button type="button" disabled={busy} onClick={() => void loadEmployees(selected, employeeNextPage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
      <label>{t("Date", "التاريخ")} <input name="workDate" type="date" required /></label>
      <label>{t("Start time", "وقت الدخول")} <input name="start" type="time" required /></label>
      <label>{t("End time (optional)", "وقت الخروج (اختياري)")} <input name="end" type="time" /></label>
      <label>{t("Note", "ملاحظة")} <input name="note" maxLength={1000} /></label>
      <button disabled={busy || !eligible.length}>{t("Record attendance", "تسجيل الحضور")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Attendance records", "سجلات الحضور")}</h2>
    {records.length === 0 && <p>{t("No records on this page.", "لا توجد سجلات في هذه الصفحة.")}</p>}
    {records.map((record) => {
      const rights = record.branchId ? scope.branches.find((branch) => branch.id === record.branchId)?.canManage : scope.companyCanManage;
      return <article key={record.id} className="card"><strong>{record.employee.fullName}</strong> · {record.employee.code}
        <p>{record.workDate.slice(0, 10)} · {clock(record.startMinute)} {t("to", "إلى")} {record.endMinute === null ? t("Open", "مفتوح") : clock(record.endMinute)} · {record.branchId ? scope.branches.find((branch) => branch.id === record.branchId)?.name : t("Company wide", "على مستوى الشركة")}</p>
        {record.note && <p>{record.note}</p>}
        {rights && record.endMinute === null && <form action={(form) => mutate(`/api/attendance/${record.id}`, "PATCH",
          { tenantId: scope.tenantId, endMinute: minute(form.get("end")), note: form.get("note") || null },
          t("Exit time recorded", "تم تسجيل وقت الخروج"), page)}>
          <label>{t("End time", "وقت الخروج")} <input name="end" type="time" required /></label>
          <label>{t("Note", "ملاحظة")} <input name="note" defaultValue={record.note ?? ""} maxLength={1000} /></label>
          <button disabled={busy}>{t("Close entry", "إغلاق السجل")}</button>
        </form>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
