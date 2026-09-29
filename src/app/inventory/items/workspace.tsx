"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Item = { id: string; sku: string; name: string; unit: string; description: string | null;
  branchId: string | null; archivedAt: string | null };

export function ItemsWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
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
    const response = await fetch(`/api/inventory/items?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load items"); return; }
    setItems(data.items); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options]);
  useEffect(() => { void load(selected, 0, archived); }, [load, selected, archived]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!option) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/inventory/items", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
        branchId: values.get("branchId") || null, sku: String(values.get("sku")).toUpperCase(),
        name: values.get("name"), unit: values.get("unit"), description: values.get("description") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not add item"); return; }
    form.reset(); setArchived(false); await load(selected);
  }
  async function update(event: FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    if (!option) return;
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/inventory/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "update", name: values.get("name"),
        unit: values.get("unit"), description: values.get("description") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not update item"); return; }
    setEditing(null); await load(selected, page, archived);
  }
  async function archive(item: Item) {
    if (!option) return;
    const response = await fetch(`/api/inventory/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "archive", archived: !item.archivedAt }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not change item status"); return; }
    await load(selected, page, archived);
  }
  if (!option) return <section><p>No accessible companies yet.</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section><label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setEditing(null); }}>
    {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form onSubmit={(event) => void create(event)} className="crm-form">
      <h2>Add item</h2>
      <input name="sku" required pattern="[A-Za-z0-9-]{2,40}" maxLength={40} placeholder="SKU" />
      <input name="name" required minLength={2} maxLength={160} placeholder="Item name" />
      <input name="unit" required pattern="[A-Za-z0-9-]{1,16}" maxLength={16} defaultValue="EA" placeholder="Unit (EA, KG, L)" />
      <input name="description" maxLength={1000} placeholder="Description (optional)" />
      <select name="branchId" required={!option.companyPermissions.canCreate}>
        {option.companyPermissions.canCreate && <option value="">Company-wide</option>}
        {!option.companyPermissions.canCreate && <option value="">Select branch</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select><button>Add item</button>
    </form>}
    <div className="formrow"><h2>Item records</h2><button type="button" onClick={() => { setArchived(!archived); setEditing(null); }}>
      {archived ? "Show active" : "Show archived"}</button></div>
    <div className="customer-list">{items.map((item) => {
      const branch = option.branches.find((entry) => entry.id === item.branchId);
      const permissions = item.branchId ? branch : option.companyPermissions;
      return <article key={item.id}>{editing === item.id ?
        <form className="crm-form" onSubmit={(event) => void update(event, item)}>
          <input name="name" defaultValue={item.name} required minLength={2} maxLength={160} />
          <input name="unit" defaultValue={item.unit} required pattern="[A-Za-z0-9-]{1,16}" maxLength={16} />
          <input name="description" defaultValue={item.description ?? ""} maxLength={1000} />
          <button>Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button>
        </form> : <><div><h3>{item.name}</h3>
          <p>{item.sku} · {item.unit} · {branch?.name ?? "Company-wide"}</p><p>{item.description ?? ""}</p></div>
          <div className="customer-actions">
            {permissions?.canUpdate && !item.archivedAt && <button onClick={() => setEditing(item.id)}>Edit</button>}
            {permissions?.canArchive && <button onClick={() => void archive(item)}>{item.archivedAt ? "Restore" : "Archive"}</button>}
          </div></>}
      </article>;
    })}</div>
    {!items.length && <p>No items on this page.</p>}
    <div className="formrow">{page > 0 && <button onClick={() => void load(selected, page - 1, archived)}>Previous</button>}
      {nextPage !== null && <button onClick={() => void load(selected, nextPage, archived)}>Next</button>}</div>
  </section>;
}
