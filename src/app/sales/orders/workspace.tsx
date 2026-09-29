"use client";

import { useCallback, useEffect, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string };
type Order = { id: string; number: string; quoteId: string; customerName: string;
  currency: string; subtotal: string; lines: { description: string; quantity: number;
    unitPrice: string; amount: string }[] };

export function OrdersWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
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
  if (!options.length) return <section><p>No accessible companies yet.</p></section>;
  return <section><label>Company <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
    {options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    <div className="customer-list">{orders.map((order) => <article key={order.id}><div>
      <h3>{order.number} · {order.customerName}</h3><p>From quote · {order.subtotal} {order.currency}</p>
      <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
    </div></article>)}</div>
    {!orders.length && <p>No orders on this page.</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
