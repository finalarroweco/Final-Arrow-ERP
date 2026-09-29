"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Supplier = { id: string; code: string; displayName: string; legalName: string | null;
  email: string | null; phone: string | null; notes: string | null; branchId: string | null;
  archivedAt: string | null };

export function SuppliersWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0, showArchived = false) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      page: String(pageNumber), archived: String(showArchived) });
    const response = await fetch(`/api/suppliers?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load suppliers"); return; }
    setSuppliers(data.suppliers); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options]);
  useEffect(() => { void load(selected, 0, archived); }, [load, selected, archived]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!option) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
        branchId: values.get("branchId") || null, code: String(values.get("code")).toUpperCase(),
        displayName: values.get("displayName"), legalName: values.get("legalName") || null,
        email: values.get("email") || null, phone: values.get("phone") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not add supplier"); return; }
    form.reset(); setArchived(false); await load(selected);
  }
  async function update(event: FormEvent<HTMLFormElement>, supplier: Supplier) {
    event.preventDefault();
    if (!option) return;
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "update", displayName: values.get("displayName"),
        legalName: values.get("legalName") || null, email: values.get("email") || null,
        phone: values.get("phone") || null, notes: values.get("notes") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not update supplier"); return; }
    setEditing(null); await load(selected, page, archived);
  }
  async function archive(supplier: Supplier) {
    if (!option) return;
    const response = await fetch(`/api/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "archive", archived: !supplier.archivedAt }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not change supplier status"); return; }
    await load(selected, page, archived);
  }
  if (!option) return <section><p>No accessible companies yet.</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section><label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setEditing(null); }}>
    {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form onSubmit={(event) => void create(event)} className="crm-form">
      <h2>Add supplier</h2>
      <input name="code" required pattern="[A-Za-z0-9-]{2,30}" maxLength={30} placeholder="Supplier code" />
      <input name="displayName" required minLength={2} maxLength={160} placeholder="Supplier name" />
      <input name="legalName" maxLength={200} placeholder="Legal name (optional)" />
      <input name="email" type="email" placeholder="Email (optional)" />
      <input name="phone" maxLength={40} placeholder="Phone (optional)" />
      <select name="branchId" required={!option.companyPermissions.canCreate}>
        {option.companyPermissions.canCreate && <option value="">Company-wide</option>}
        {!option.companyPermissions.canCreate && <option value="">Select branch</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select><button>Add supplier</button>
    </form>}
    <div className="formrow"><h2>Supplier records</h2><button type="button" onClick={() => { setArchived(!archived); setEditing(null); }}>
      {archived ? "Show active" : "Show archived"}</button></div>
    <div className="customer-list">{suppliers.map((supplier) => {
      const branch = option.branches.find((item) => item.id === supplier.branchId);
      const permissions = supplier.branchId ? branch : option.companyPermissions;
      return <article key={supplier.id}>{editing === supplier.id ?
        <form className="crm-form" onSubmit={(event) => void update(event, supplier)}>
          <input name="displayName" defaultValue={supplier.displayName} required minLength={2} maxLength={160} />
          <input name="legalName" defaultValue={supplier.legalName ?? ""} maxLength={200} />
          <input name="email" type="email" defaultValue={supplier.email ?? ""} />
          <input name="phone" defaultValue={supplier.phone ?? ""} maxLength={40} />
          <input name="notes" defaultValue={supplier.notes ?? ""} maxLength={2000} />
          <button>Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form> : <><div><h3>{supplier.displayName}</h3>
          <p>{supplier.code} · {branch?.name ?? "Company-wide"}</p><p>{supplier.email ?? ""} {supplier.phone ?? ""}</p></div>
          <div className="customer-actions">
            {permissions?.canUpdate && !supplier.archivedAt && <button onClick={() => setEditing(supplier.id)}>Edit</button>}
            {permissions?.canArchive && <button onClick={() => void archive(supplier)}>{supplier.archivedAt ? "Restore" : "Archive"}</button>}
          </div></>}
      </article>;
    })}</div>
    {!suppliers.length && <p>No suppliers on this page.</p>}
    <div className="formrow">{page > 0 && <button onClick={() => void load(selected, page - 1, archived)}>Previous</button>}
      {nextPage !== null && <button onClick={() => void load(selected, nextPage, archived)}>Next</button>}</div>
  </section>;
}
