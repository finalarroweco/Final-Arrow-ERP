"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Rights = { canCreate: boolean; canIssue: boolean; canVoid: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Order = { id: string; number: string; customerName: string; branchId: string | null;
  status: string; currency: string; subtotal: string; invoice: { id: string } | null };
type Invoice = { id: string; number: string; orderId: string; customerName: string;
  branchId: string | null; status: "DRAFT" | "ISSUED" | "VOID"; currency: string;
  subtotal: string; voidReason: string | null;
  lines: { description: string; quantity: number; unitPrice: string; amount: string }[] };

export function InvoicesWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const option = options[index];
    if (!option) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId,
      page: String(pageNumber) });
    const response = await fetch(`/api/invoices?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load invoices"); return; }
    setInvoices(data.invoices); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options]);
  const loadOrders = useCallback(async (index: number) => {
    const option = options[index];
    if (!option || !(option.companyPermissions.canCreate || option.branches.some((branch) => branch.canCreate))) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId });
    const response = await fetch(`/api/orders?${query}`);
    if (response.ok) setOrders((await response.json()).orders);
  }, [options]);
  useEffect(() => { void load(selected); void loadOrders(selected); }, [load, loadOrders, selected]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${values.get("orderId")}/invoice`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, number: values.get("number") }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not create invoice");
      else { form.reset(); await Promise.all([load(selected), loadOrders(selected)]); }
    } finally { setBusy(false); }
  }
  async function change(invoice: Invoice, action: "issue" | "void", reason?: string) {
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invoices/${invoice.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, action, ...(action === "void" ? { reason } : {}) }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not update invoice");
      else await load(selected, page);
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>No accessible companies yet.</p></section>;
  const eligibleOrders = orders.filter((order) => order.status === "COMPLETED" && !order.invoice &&
    (order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canCreate
      : scope.companyPermissions.canCreate));
  return <section><label>Company <select value={selected} onChange={(event) => {
    setSelected(Number(event.target.value)); setInvoices([]); setOrders([]);
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}</select></label>
    {(scope.companyPermissions.canCreate || scope.branches.some((branch) => branch.canCreate)) &&
      <form onSubmit={(event) => void create(event)} className="crm-form"><h2>New internal invoice</h2>
        <select name="orderId" required defaultValue=""><option value="">Completed sales order</option>
          {eligibleOrders.map((order) => <option key={order.id} value={order.id}>
            {order.number} · {order.customerName} · {order.subtotal} {order.currency}</option>)}</select>
        <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="Invoice number, e.g. INV-001" />
        <button disabled={busy || !eligibleOrders.length}>Create draft</button>
      </form>}
    {error && <p role="alert">{error}</p>}
    <div className="customer-list">{invoices.map((invoice) => {
      const rights = invoice.branchId ? scope.branches.find((branch) => branch.id === invoice.branchId)
        : scope.companyPermissions;
      return <article key={invoice.id}><div><h3>{invoice.number} · {invoice.customerName}</h3>
        <p>{invoice.status} · {invoice.subtotal} {invoice.currency}</p>
        <ul>{invoice.lines.map((line, index) => <li key={index}>
          {line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {invoice.voidReason && <p>Void reason: {invoice.voidReason}</p>}
        <div className="quote-actions">
          {rights?.canIssue && invoice.status === "DRAFT" && <button disabled={busy}
            onClick={() => void change(invoice, "issue")}>Mark issued</button>}
        </div>
        {rights?.canVoid && invoice.status !== "VOID" && <form className="formrow"
          onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget);
            void change(invoice, "void", String(values.get("reason"))); }}>
          <input name="reason" required minLength={3} maxLength={300} placeholder="Reason to void" />
          <button disabled={busy}>Void</button>
        </form>}
      </div></article>;
    })}</div>
    {!invoices.length && <p>No invoices on this page.</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
