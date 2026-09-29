"use client";

import { useCallback, useEffect, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string; canManageCompanyWide: boolean;
  branches: { id: string; canManage: boolean }[] };
type Order = { id: string; number: string; quoteId: string; customerName: string;
  status: "NEW" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"; branchId: string | null;
  currency: string; subtotal: string; lines: { description: string; quantity: number;
    unitPrice: string; amount: string }[] };

export function OrdersWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/orders?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load orders"); return; }
    setOrders(data.orders); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function change(order: Order, action: "start" | "complete" | "cancel") {
    const scope = options[selected];
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not update order");
      else await load(selected, page);
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>No accessible companies yet.</p></section>;
  return <section><label>Company <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
    {options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    <div className="customer-list">{orders.map((order) => {
      const scope = options[selected];
      const canManage = order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canManage
        : scope.canManageCompanyWide;
      return <article key={order.id}><div>
      <h3>{order.number} · {order.customerName}</h3><p>{order.status.replace("_", " ")} · {order.subtotal} {order.currency}</p>
      <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
      {canManage && <div className="quote-actions">
        {order.status === "NEW" && <button disabled={busy} onClick={() => void change(order, "start")}>Start work</button>}
        {order.status === "IN_PROGRESS" && <button disabled={busy} onClick={() => void change(order, "complete")}>Complete</button>}
        {["NEW", "IN_PROGRESS"].includes(order.status) && <button disabled={busy}
          onClick={() => void change(order, "cancel")}>Cancel</button>}
      </div>}
    </div></article>})}</div>
    {!orders.length && <p>No orders on this page.</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
