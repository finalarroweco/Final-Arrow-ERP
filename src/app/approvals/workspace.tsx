"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string;
  branches: { id: string; name: string }[] };
type Item = { type: "LEAVE" | "EXPENSE" | "PURCHASE"; id: string; branchId: string | null;
  createdAt: string; title: string; detail: string };
type Counts = { leave: number; expense: number; purchase: number };

export function ApprovalsWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Counts>({ leave: 0, expense: 0, purchase: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestNumber = useRef(0);
  const scope = options[selected];
  const load = useCallback(async (index: number) => {
    const option = options[index];
    if (!option) return;
    const currentRequest = ++requestNumber.current;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId });
    const response = await fetch(`/api/approvals?${query}`);
    const data = await response.json();
    if (currentRequest !== requestNumber.current) return;
    if (!response.ok) { setMessage(data.error ?? "Could not load approvals"); return; }
    setItems(data.items); setCounts(data.counts); setHasMore(data.hasMore);
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function act(item: Item, action: string, note?: string) {
    if (!scope) return;
    const url = item.type === "LEAVE" ? `/api/leave-requests/${item.id}`
      : item.type === "EXPENSE" ? `/api/expenses/${item.id}/status`
        : `/api/purchase-orders/${item.id}/status`;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action, ...(note ? { [item.type === "LEAVE" ? "note" : "reason"]: note } : {}) }) });
      const data = await response.json();
      setMessage(response.ok ? "Decision saved" : data.error ?? "Action failed");
      if (response.ok) await load(selected);
    } catch { setMessage("Network request failed"); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>No actionable records within your access.</p></section>;
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => {
      setSelected(Number(event.target.value)); setItems([]); setCounts({ leave: 0, expense: 0, purchase: 0 }); setMessage("");
    }}>{options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}</select></label>
    <p>Pending leave: {counts.leave} · Expense drafts: {counts.expense} · Purchase order drafts: {counts.purchase}</p>
    {message && <p role="status">{message}</p>}
    {items.length === 0 && <p>No actions waiting.</p>}
    {items.map((item) => <article key={`${item.type}:${item.id}`} className="card">
      <small>{item.type} · {item.branchId ? scope.branches.find((branch) => branch.id === item.branchId)?.name : "Company wide"}</small>
      <h3>{item.title}</h3><p>{item.detail}</p>
      {item.type === "LEAVE" && <button disabled={busy} onClick={() => void act(item, "approve")}>Approve leave</button>}
      {item.type === "EXPENSE" && <button disabled={busy} onClick={() => void act(item, "post")}>Post expense</button>}
      {item.type === "PURCHASE" && <button disabled={busy} onClick={() => void act(item, "issue")}>Issue purchase order</button>}
      {item.type !== "PURCHASE" && <form action={(form) => act(item,
        item.type === "LEAVE" ? "reject" : "void", String(form.get("note")))}>
        <label>Reason <input name="note" required minLength={3} maxLength={300} /></label>
        <button disabled={busy}>{item.type === "LEAVE" ? "Reject leave" : "Void expense"}</button>
      </form>}
      <p><a href={item.type === "LEAVE" ? "/hr/leave"
        : item.type === "EXPENSE" ? "/accounting/expenses" : "/purchasing/orders"}>Open module</a></p>
    </article>)}
    {hasMore && <p>Showing the latest 25 actions. Open a module to review its full list.</p>}
    <button disabled={busy} onClick={() => void load(selected)}>Refresh</button>
  </section>;
}
