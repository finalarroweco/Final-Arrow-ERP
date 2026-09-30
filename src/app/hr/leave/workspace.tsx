"use client";

import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canDecide: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Employee = { id: string; fullName: string; code: string; branchId: string | null };
type Leave = { id: string; employee: { fullName: string; code: string }; branchId: string | null;
  type: "ANNUAL" | "SICK" | "UNPAID" | "OTHER"; startDate: string; endDate: string;
  note: string | null; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; decisionNote: string | null };

export function LeaveWorkspace({ options }: { options: Option[] }) {
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
    if (!response.ok) { setMessage(data.error ?? "Could not load leave requests"); return; }
    setRequests(data.requests); setPage(number); setNextPage(data.nextPage);
  }, [options]);
  const loadEmployees = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option || !(option.companyRights.canCreate || option.branches.some((branch) => branch.canCreate))) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/employees?${query}`);
    if (!response.ok) { setMessage("Could not load employees"); return; }
    const data = await response.json();
    setEmployees((previous) => number === 0 ? data.employees : [...previous, ...data.employees]);
    setEmployeeNextPage(data.nextPage);
  }, [options]);
  useEffect(() => { void load(selected); void loadEmployees(selected); }, [load, loadEmployees, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, number = 0) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? "Action failed");
      if (response.ok) await load(selected, number);
    } catch { setMessage("Network request failed"); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>No accessible leave records.</p></section>;
  const eligible = employees.filter((employee) => employee.branchId
    ? scope.branches.find((branch) => branch.id === employee.branchId)?.canCreate
    : scope.companyRights.canCreate);
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setRequests([]); setEmployees([]); setEmployeeNextPage(null); setMessage(""); }}>
      {options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}
    </select></label>
    {(scope.companyRights.canCreate || scope.branches.some((branch) => branch.canCreate)) && <form action={(form) => mutate(
      "/api/leave-requests", "POST", { tenantId: scope.tenantId, companyId: scope.companyId,
        employeeId: form.get("employeeId"), type: form.get("type"),
        startDate: form.get("startDate"), endDate: form.get("endDate"),
        note: form.get("note") || null }, "Leave request created")}>
      <h2>New leave request</h2>
      <label>Employee <select name="employeeId" required defaultValue="">
        <option value="">Select employee</option>
        {eligible.map((employee) => <option key={employee.id} value={employee.id}>{employee.code} · {employee.fullName}</option>)}
      </select></label>
      {employeeNextPage !== null && <button type="button" disabled={busy}
        onClick={() => void loadEmployees(selected, employeeNextPage)}>Load more employees</button>}
      <label>Type <select name="type">
        <option value="ANNUAL">Annual</option><option value="SICK">Sick</option>
        <option value="UNPAID">Unpaid</option><option value="OTHER">Other</option>
      </select></label>
      <label>Start date <input name="startDate" type="date" required /></label>
      <label>End date <input name="endDate" type="date" required /></label>
      <label>Note <input name="note" maxLength={1000} /></label>
      <button disabled={busy || !eligible.length}>Create request</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>Leave requests</h2>
    {requests.length === 0 && <p>No requests on this page.</p>}
    {requests.map((leave) => {
      const rights = leave.branchId ? scope.branches.find((branch) => branch.id === leave.branchId) : scope.companyRights;
      return <article key={leave.id} className="card">
        <strong>{leave.employee.fullName}</strong> · {leave.employee.code}
        <p>{leave.type} · {leave.startDate.slice(0, 10)} to {leave.endDate.slice(0, 10)} · {leave.status} · {leave.branchId ? scope.branches.find((branch) => branch.id === leave.branchId)?.name : "Company wide"}</p>
        {leave.note && <p>{leave.note}</p>}{leave.decisionNote && <p>Decision note: {leave.decisionNote}</p>}
        {rights?.canDecide && leave.status === "PENDING" && <button disabled={busy}
          onClick={() => void mutate(`/api/leave-requests/${leave.id}`, "PATCH",
            { tenantId: scope.tenantId, action: "approve" }, "Leave approved", page)}>Approve</button>}
        {rights?.canDecide && (leave.status === "PENDING" || leave.status === "APPROVED") && <form action={(form) => mutate(
          `/api/leave-requests/${leave.id}`, "PATCH",
          { tenantId: scope.tenantId, action: form.get("action"), note: form.get("note") },
          "Leave request updated", page)}>
          <label>Reason <input name="note" required minLength={3} maxLength={500} /></label>
          {leave.status === "PENDING" && <button disabled={busy} name="action" value="reject">Reject</button>}
          <button disabled={busy} name="action" value="cancel">Cancel</button>
        </form>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
