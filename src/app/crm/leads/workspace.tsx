"use client";

import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canConvert: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Lead = { id: string; code: string; displayName: string; email: string | null; phone: string | null;
  branchId: string | null; stage: "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
  convertedCustomerId: string | null };

export function LeadsWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/leads?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load leads"); return; }
    setLeads(data.leads); setPage(pageNumber); setNextPage(data.nextPage);
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function create(form: FormData) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
          branchId: form.get("branchId") || null, code: form.get("code"), displayName: form.get("displayName"),
          email: form.get("email") || null, phone: form.get("phone") || null }) });
      const data = await response.json();
      setMessage(response.ok ? "Lead created" : data.error ?? "Could not create lead");
      if (response.ok) await load(selected);
    } finally { setBusy(false); }
  }
  async function change(lead: Lead, action: "stage" | "convert", stage?: Lead["stage"]) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/leads/${lead.id}${action === "convert" ? "/convert" : ""}`, {
        method: action === "convert" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "convert"
          ? { tenantId: option.tenantId, customerCode: lead.code }
          : { tenantId: option.tenantId, stage }),
      });
      const data = await response.json();
      setMessage(response.ok ? action === "convert" ? "Customer created" : "Stage updated" : data.error ?? "Action failed");
      if (response.ok) await load(selected, page);
    } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>No accessible companies yet.</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setMessage(""); }}>
      {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={create}>
      <h2>New lead</h2>
      <label>Code <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="LEAD-001" /></label>
      <label>Name <input name="displayName" required minLength={2} maxLength={160} /></label>
      <label>Email <input name="email" type="email" /></label>
      <label>Phone <input name="phone" /></label>
      <label>Branch <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">Company wide</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>Create lead</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>Pipeline</h2>
    {leads.length === 0 && <p>No leads on this page.</p>}
    {leads.map((lead) => {
      const permissions = lead.branchId ? option.branches.find((branch) => branch.id === lead.branchId) : option.companyPermissions;
      return <article key={lead.id} className="card"><strong>{lead.displayName}</strong> · {lead.code}
        <p>{lead.stage} {lead.email && `· ${lead.email}`} {lead.phone && `· ${lead.phone}`}</p>
        {lead.stage !== "WON" && <div>
          {permissions?.canUpdate && <select disabled={busy} value={lead.stage} aria-label={`Stage for ${lead.displayName}`}
            onChange={(event) => void change(lead, "stage", event.target.value as Lead["stage"])}>
            {(["NEW", "QUALIFIED", "PROPOSAL", "LOST"] as const).map((stage) => <option key={stage}>{stage}</option>)}
          </select>}
          {permissions?.canConvert && lead.stage !== "LOST" && <button disabled={busy}
            onClick={() => void change(lead, "convert")}>Convert to customer</button>}
        </div>}
        {lead.convertedCustomerId && <p>Customer ID: {lead.convertedCustomerId}</p>}
      </article>;
    })}
    <div>{page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>Previous</button>}
      {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>Next</button>}</div>
  </section>;
}
