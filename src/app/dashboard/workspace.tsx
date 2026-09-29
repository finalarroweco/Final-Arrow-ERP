"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Option = { tenantId: string; companyId: string; label: string };
type Summary = { customers: number | null;
  leads: Record<string, number> | null; quotes: Record<string, number> | null;
  orders: Record<string, number> | null };

export function DashboardWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const requestNumber = useRef(0);
  const load = useCallback(async (index: number) => {
    const scope = options[index];
    if (!scope) return;
    const currentRequest = ++requestNumber.current;
    setSummary(null);
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId });
    const response = await fetch(`/api/dashboard?${query}`);
    const data = await response.json();
    if (currentRequest !== requestNumber.current) return;
    if (!response.ok) { setError(data.error ?? "Could not load dashboard"); return; }
    setSummary(data); setError("");
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  if (!options.length) return <section><p>No accessible companies yet.</p></section>;
  return <section><label>Company <select value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
    {options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {!summary && !error && <p>Loading activity…</p>}
    {summary && <div className="dashboard-grid">
      {summary.customers !== null && <article><small>CRM</small><h2>{summary.customers}</h2><p>Active customers</p><a href="/crm">Open customers</a></article>}
      {summary.leads && <article><small>PIPELINE</small><h2>{summary.leads.NEW + summary.leads.QUALIFIED + summary.leads.PROPOSAL}</h2>
        <p>Open leads · {summary.leads.WON} won · {summary.leads.LOST} lost</p><a href="/crm/leads">Open leads</a></article>}
      {summary.quotes && <article><small>SALES</small><h2>{summary.quotes.DRAFT + summary.quotes.SENT}</h2>
        <p>Active quotes · {summary.quotes.ACCEPTED} accepted · {summary.quotes.REJECTED} rejected</p><a href="/sales/quotes">Open quotes</a></article>}
      {summary.orders && <article><small>OPERATIONS</small><h2>{summary.orders.NEW + summary.orders.IN_PROGRESS}</h2>
        <p>Open orders · {summary.orders.COMPLETED} completed · {summary.orders.CANCELLED} cancelled</p><a href="/sales/orders">Open orders</a></article>}
    </div>}
    <button onClick={() => void load(selected)}>Refresh</button>
  </section>;
}
