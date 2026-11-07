"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canManage: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Employee = { id: string; code: string; fullName: string; jobTitle: string | null; email: string | null;
  phone: string | null; startDate: string | null; status: "ACTIVE" | "INACTIVE"; branchId: string | null };

export function EmployeesWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [inactive, setInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const option = options[selected];
  const load = useCallback(async (index: number, showInactive: boolean, number = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      page: String(number), inactive: String(showInactive), ...filters });
    const response = await fetch(`/api/employees?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load employees", "تعذر تحميل الموظفين")); return; }
    setEmployees(data.employees); setPage(number); setNextPage(data.nextPage);
  }, [options, t, filters]);
  useEffect(() => { void load(selected, inactive); }, [load, selected, inactive]);
  async function mutate(url: string, body: object, method: "POST" | "PATCH", success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await load(selected, inactive, method === "POST" ? 0 : page);
    } catch { setMessage(t("Network request failed", "فشل الاتصال بالشبكة")); } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>{t("No accessible employee records.", "لا توجد سجلات موظفين متاحة.")}</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setFilters({}); setEmployees([]); setMessage(""); }}>
      {options.map((item, index) => <option key={item.companyId} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/employees",
      { tenantId: option.tenantId, companyId: option.companyId, branchId: form.get("branchId") || null,
        code: form.get("code"), fullName: form.get("fullName"), jobTitle: form.get("jobTitle") || null,
        email: form.get("email") || null, phone: form.get("phone") || null,
        startDate: form.get("startDate") || null }, "POST", t("Employee created", "تم إنشاء الموظف"))}>
      <h2>{t("New employee", "موظف جديد")}</h2>
      <label>{t("Code", "الرمز")} <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="EMP-001" /></label>
      <label>{t("Full name", "الاسم الكامل")} <input name="fullName" required minLength={2} maxLength={160} /></label>
      <label>{t("Job title", "المسمى الوظيفي")} <input name="jobTitle" maxLength={120} /></label>
      <label>{t("Email", "البريد الإلكتروني")} <input name="email" type="email" /></label>
      <label>{t("Phone", "الهاتف")} <input name="phone" maxLength={40} /></label>
      <label>{t("Start date", "تاريخ البدء")} <input name="startDate" type="date" /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>{t("Add employee", "إضافة موظف")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <label><input type="checkbox" checked={inactive} onChange={(event) => { setInactive(event.target.checked); setEmployees([]); }} /> {t("Show inactive employees", "عرض الموظفين غير النشطين")}</label>
    <h2>{inactive ? t("Inactive employees", "الموظفون غير النشطين") : t("Employees", "الموظفون")}</h2>
    <form key={`filters-${selected}`} onSubmit={(event) => { event.preventDefault();
      const form = new FormData(event.currentTarget);
      setFilters(Object.fromEntries(["q", "branchId"].map((key) => [key, String(form.get(key) ?? "").trim()]).filter(([, value]) => value)));
      setEmployees([]);
    }}>
      <label>{t("Name or employee code", "اسم الموظف أو رمزه")} <input name="q" maxLength={160} /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId"><option value="">{t("All visible branches", "كل الفروع المتاحة")}</option>
        {option.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>{t("Search", "بحث")}</button>
      <button type="reset" disabled={busy} onClick={() => { setFilters({}); setEmployees([]); }}>{t("Clear filters", "مسح التصفية")}</button>
    </form>
    {employees.length === 0 && <p>{t("No employees on this page.", "لا يوجد موظفون في هذه الصفحة.")}</p>}
    {employees.map((employee) => {
      const permissions = employee.branchId ? option.branches.find((branch) => branch.id === employee.branchId) : option.companyPermissions;
      return <article key={employee.id} className="card"><strong>{employee.fullName}</strong> · {employee.code}
        <p>{employee.jobTitle ?? t("No job title", "لا يوجد مسمى وظيفي")} · {employee.branchId ? option.branches.find((branch) => branch.id === employee.branchId)?.name : t("Company wide", "على مستوى الشركة")}{employee.startDate && ` · ${t("Since", "منذ")} ${employee.startDate.slice(0, 10)}`}</p>
        {employee.email && <p>{employee.email}</p>}{employee.phone && <p>{employee.phone}</p>}
        {permissions?.canManage && <div>
          {!inactive && <details><summary>{t("Edit employee", "تعديل الموظف")}</summary><form action={(form) => mutate(`/api/employees/${employee.id}`,
            { tenantId: option.tenantId, action: "update", fullName: form.get("fullName"),
              jobTitle: form.get("jobTitle") || null, email: form.get("email") || null,
              phone: form.get("phone") || null, startDate: form.get("startDate") || null },
            "PATCH", t("Employee updated", "تم تحديث الموظف"))}>
            <label>{t("Full name", "الاسم الكامل")} <input name="fullName" defaultValue={employee.fullName} required minLength={2} maxLength={160} /></label>
            <label>{t("Job title", "المسمى الوظيفي")} <input name="jobTitle" defaultValue={employee.jobTitle ?? ""} maxLength={120} /></label>
            <label>{t("Email", "البريد الإلكتروني")} <input name="email" type="email" defaultValue={employee.email ?? ""} /></label>
            <label>{t("Phone", "الهاتف")} <input name="phone" defaultValue={employee.phone ?? ""} maxLength={40} /></label>
            <label>{t("Start date", "تاريخ البدء")} <input name="startDate" type="date" defaultValue={employee.startDate?.slice(0, 10) ?? ""} /></label>
            <button disabled={busy}>{t("Save employee", "حفظ الموظف")}</button>
          </form></details>}
          <button disabled={busy} onClick={() => void mutate(`/api/employees/${employee.id}`,
            { tenantId: option.tenantId, action: "status", status: inactive ? "ACTIVE" : "INACTIVE" },
            "PATCH", inactive ? t("Employee activated", "تم تفعيل الموظف") : t("Employee deactivated", "تم إلغاء تفعيل الموظف"))}>{inactive ? t("Reactivate", "إعادة التفعيل") : t("Deactivate", "إلغاء التفعيل")}</button>
        </div>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, inactive, page - 1)}>{t("Previous", "السابق")}</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, inactive, nextPage)}>{t("Next", "التالي")}</button>}
  </section>;
}
