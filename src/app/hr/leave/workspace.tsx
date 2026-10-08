"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canDecide: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Employee = { id: string; fullName: string; code: string; branchId: string | null };
type Leave = { id: string; employee: { fullName: string; code: string }; branchId: string | null;
  type: "ANNUAL" | "SICK" | "UNPAID" | "OTHER"; startDate: string; endDate: string;
  note: string | null; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decisionNote: string | null };

export function LeaveWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [requests, setRequests] = useState<Leave[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeNextPage, setEmployeeNextPage] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/leave-requests?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load leave requests", "تعذر تحميل طلبات الإجازة")); return; }
    setRequests(data.requests); setPage(number); setNextPage(data.nextPage);
  }, [options, t]);
  const loadEmployees = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option || !(option.companyRights.canCreate || option.branches.some((branch) => branch.canCreate))) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/employees?${query}`);
    if (!response.ok) { setMessage(t("Could not load employees", "تعذر تحميل الموظفين")); return; }
    const data = await response.json();
    setEmployees((previous) => number === 0 ? data.employees : [...previous, ...data.employees]);
    setEmployeeNextPage(data.nextPage);
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
  if (!scope) return <section className="panel"><p>{t("No accessible leave records.", "لا توجد سجلات إجازات متاحة.")}</p></section>;
  const eligible = employees.filter((employee) => employee.branchId
    ? scope.branches.find((branch) => branch.id === employee.branchId)?.canCreate
    : scope.companyRights.canCreate);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setRequests([]); setEmployees([]); setEmployeeNextPage(null); setMessage(""); }}>
      {options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}
    </select></label>
    {(scope.companyRights.canCreate || scope.branches.some((branch) => branch.canCreate)) && <form action={(form) => mutate(
      "/api/leave-requests", "POST", { tenantId: scope.tenantId, companyId: scope.companyId,
        employeeId: form.get("employeeId"), type: form.get("type"),
        startDate: form.get("startDate"), endDate: form.get("endDate"),
        note: form.get("note") || null }, t("Leave request created", "تم إنشاء طلب الإجازة"))}>
      <h2>{t("New leave request", "طلب إجازة جديد")}</h2>
      <label>{t("Employee", "الموظف")} <select name="employeeId" required defaultValue="">
        <option value="">{t("Select employee", "اختر موظفاً")}</option>
        {eligible.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
      </select></label>
      {employeeNextPage !== null && <button type="button" disabled={busy}
        onClick={() => void loadEmployees(selected, employeeNextPage)}>{t("Load more employees", "تحميل المزيد من الموظفين")}</button>}
      <label>{t("Type", "النوع")} <select name="type">
        <option value="ANNUAL">{t("Annual", "سنوية")}</option><option value="SICK">{t("Sick", "مرضية")}</option>
        <option value="UNPAID">{t("Unpaid", "غير مدفوعة")}</option><option value="OTHER">{t("Other", "أخرى")}</option>
      </select></label>
      <label>{t("Start date", "تاريخ البداية")} <input name="startDate" type="date" required /></label>
      <label>{t("End date", "تاريخ النهاية")} <input name="endDate" type="date" required /></label>
      <label>{t("Note", "ملاحظة")} <input name="note" maxLength={1000} /></label>
      <button disabled={busy || !eligible.length}>{t("Create request", "إنشاء الطلب")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Leave requests", "طلبات الإجازة")}</h2>
    {requests.length === 0 && <p>{t("No requests on this page.", "لا توجد طلبات في هذه الصفحة.")}</p>}
    {requests.map((leave) => {
      const rights = leave.branchId ? scope.branches.find((branch) => branch.id === leave.branchId) : scope.companyRights;
      return <article key={leave.id} className="card">
        <strong>{leave.employee.fullName}</strong> · {leave.employee.code}
        <p>{t(leave.type, ({ ANNUAL: "سنوية", SICK: "مرضية", UNPAID: "غير مدفوعة", OTHER: "أخرى" })[leave.type])} · {leave.startDate.slice(0, 10)} {t("to", "إلى")} {leave.endDate.slice(0, 10)} · {t(leave.status, ({ PENDING: "معلّقة", APPROVED: "مقبولة", REJECTED: "مرفوضة", CANCELLED: "ملغاة" })[leave.status])} · {leave.branchId ? scope.branches.find((branch) => branch.id === leave.branchId)?.name : t("Company wide", "على مستوى الشركة")}</p>
        {leave.note && <p>{leave.note}</p>}{leave.decisionNote && <p>{t("Decision note:", "ملاحظة القرار:")} {leave.decisionNote}</p>}
        {rights?.canDecide && leave.status === "PENDING" && <button disabled={busy}
          onClick={() => void mutate(`/api/leave-requests/${leave.id}`, "PATCH",
            { tenantId: scope.tenantId, action: "approve" }, t("Leave approved", "تمت الموافقة على الإجازة"), page)}>{t("Approve", "موافقة")}</button>}
        {rights?.canDecide && (leave.status === "PENDING" || leave.status === "APPROVED") && <form action={(form) => mutate(
          `/api/leave-requests/${leave.id}`, "PATCH",
          { tenantId: scope.tenantId, action: form.get("action"), note: form.get("note") },
          t("Leave request updated", "تم تحديث طلب الإجازة"), page)}>
          <label>{t("Reason", "السبب")} <input name="note" required minLength={3} maxLength={500} /></label>
          {leave.status === "PENDING" && <button disabled={busy} name="action" value="reject">{t("Reject", "رفض")}</button>}
          <button disabled={busy} name="action" value="cancel">{t("Cancel", "إلغاء")}</button>
        </form>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
