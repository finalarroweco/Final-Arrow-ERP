"use client";

import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canManage: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Employee = { id: string; code: string; fullName: string; jobTitle: string | null; email: string | null;
  phone: string | null; startDate: string | null; status: "ACTIVE" | "INACTIVE"; branchId: string | null };

export function EmployeesWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
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
      page: String(number), inactive: String(showInactive) });
    const response = await fetch(`/api/employees?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load employees"); return; }
    setEmployees(data.employees); setPage(number); setNextPage(data.nextPage);
  }, [options]);
  useEffect(() => { void load(selected, inactive); }, [load, selected, inactive]);
  async function mutate(url: string, body: object, method: "POST" | "PATCH", success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? "Action failed");
      if (response.ok) await load(selected, inactive, method === "POST" ? 0 : page);
    } catch { setMessage("Network request failed"); } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>No accessible employee records.</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setEmployees([]); setMessage(""); }}>
      {options.map((item, index) => <option key={item.companyId} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/employees",
      { tenantId: option.tenantId, companyId: option.companyId, branchId: form.get("branchId") || null,
        code: form.get("code"), fullName: form.get("fullName"), jobTitle: form.get("jobTitle") || null,
        email: form.get("email") || null, phone: form.get("phone") || null,
        startDate: form.get("startDate") || null }, "POST", "Employee created")}>
      <h2>New employee</h2>
      <label>Code <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="EMP-001" /></label>
      <label>Full name <input name="fullName" required minLength={2} maxLength={160} /></label>
      <label>Job title <input name="jobTitle" maxLength={120} /></label>
      <label>Email <input name="email" type="email" /></label>
      <label>Phone <input name="phone" maxLength={40} /></label>
      <label>Start date <input name="startDate" type="date" /></label>
      <label>Branch <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">Company wide</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>Add employee</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <label><input type="checkbox" checked={inactive} onChange={(event) => { setInactive(event.target.checked); setEmployees([]); }} /> Show inactive employees</label>
    <h2>{inactive ? "Inactive employees" : "Employees"}</h2>
    {employees.length === 0 && <p>No employees on this page.</p>}
    {employees.map((employee) => {
      const permissions = employee.branchId ? option.branches.find((branch) => branch.id === employee.branchId) : option.companyPermissions;
      return <article key={employee.id} className="card"><strong>{employee.fullName}</strong> · {employee.code}
        <p>{employee.jobTitle ?? "No job title"} · {employee.branchId ? option.branches.find((branch) => branch.id === employee.branchId)?.name : "Company wide"}{employee.startDate && ` · Since ${employee.startDate.slice(0, 10)}`}</p>
        {employee.email && <p>{employee.email}</p>}{employee.phone && <p>{employee.phone}</p>}
        {permissions?.canManage && <div>
          {!inactive && <details><summary>Edit employee</summary><form action={(form) => mutate(`/api/employees/${employee.id}`,
            { tenantId: option.tenantId, action: "update", fullName: form.get("fullName"),
              jobTitle: form.get("jobTitle") || null, email: form.get("email") || null,
              phone: form.get("phone") || null, startDate: form.get("startDate") || null },
            "PATCH", "Employee updated")}>
            <label>Full name <input name="fullName" defaultValue={employee.fullName} required minLength={2} maxLength={160} /></label>
            <label>Job title <input name="jobTitle" defaultValue={employee.jobTitle ?? ""} maxLength={120} /></label>
            <label>Email <input name="email" type="email" defaultValue={employee.email ?? ""} /></label>
            <label>Phone <input name="phone" defaultValue={employee.phone ?? ""} maxLength={40} /></label>
            <label>Start date <input name="startDate" type="date" defaultValue={employee.startDate?.slice(0, 10) ?? ""} /></label>
            <button disabled={busy}>Save employee</button>
          </form></details>}
          <button disabled={busy} onClick={() => void mutate(`/api/employees/${employee.id}`,
            { tenantId: option.tenantId, action: "status", status: inactive ? "ACTIVE" : "INACTIVE" },
            "PATCH", inactive ? "Employee activated" : "Employee deactivated")}>{inactive ? "Reactivate" : "Deactivate"}</button>
        </div>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, inactive, page - 1)}>Previous</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, inactive, nextPage)}>Next</button>}
  </section>;
}
