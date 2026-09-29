"use client";

import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canSend: boolean; canDecide: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string;
  companyPermissions: Permissions; branches: ({ id: string; name: string } & Permissions)[] };
type Customer = { id: string; displayName: string; branchId: string | null };
type Quote = { id: string; number: string; status: string; currency: string; subtotal: string;
  branchId: string | null; customer: { displayName: string }; lines: { description: string; quantity: number;
    unitPrice: string; amount: string }[] };
type Line = { description: string; quantity: string; unitPrice: string };

export function QuotesWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", unitPrice: "0.000" }]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const [quoteResponse, customerResponse] = await Promise.all([
      fetch(`/api/quotes?${query}`), fetch(`/api/customers?${query}`),
    ]);
    const [quoteData, customerData] = await Promise.all([quoteResponse.json(), customerResponse.json()]);
    if (!quoteResponse.ok) { setMessage(quoteData.error ?? "Could not load quotes"); return; }
    setQuotes(quoteData.quotes); setPage(pageNumber); setNextPage(quoteData.nextPage);
    if (customerResponse.ok) {
      const allCustomers: Customer[] = [...customerData.customers];
      let customerPage: number | null = customerData.nextPage;
      while (customerPage !== null) {
        const nextQuery = new URLSearchParams({ tenantId: scope.tenantId,
          companyId: scope.companyId, page: String(customerPage) });
        const nextResponse = await fetch(`/api/customers?${nextQuery}`);
        if (!nextResponse.ok) break;
        const nextData = await nextResponse.json();
        allCustomers.push(...nextData.customers);
        customerPage = nextData.nextPage;
      }
      setCustomers(allCustomers);
    } else setCustomers([]);
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  const createBranches = option?.branches.filter((branch) => branch.canCreate) ?? [];
  const effectiveBranchId = branchId || (!option?.companyPermissions.canCreate ? createBranches[0]?.id ?? "" : "");
  const availableCustomers = customers.filter((customer) => !customer.branchId || customer.branchId === effectiveBranchId);
  async function create(form: FormData) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
          branchId: effectiveBranchId || null, customerId: form.get("customerId"), number: form.get("number"),
          notes: form.get("notes") || null,
          lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice })) }) });
      const data = await response.json();
      setMessage(response.ok ? "Quote created" : data.error ?? "Could not create quote");
      if (response.ok) { setLines([{ description: "", quantity: "1", unitPrice: "0.000" }]); await load(selected); }
    } finally { setBusy(false); }
  }
  async function transition(quote: Quote, action: "send" | "accept" | "reject") {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/quotes/${quote.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, action }) });
      const data = await response.json();
      setMessage(response.ok ? `Quote marked ${data.quote.status.toLowerCase()}` : data.error ?? "Action failed");
      if (response.ok) await load(selected, page);
    } finally { setBusy(false); }
  }
  if (!option) return <section><p>No accessible companies yet.</p></section>;
  return <section>
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setBranchId(""); setMessage(""); }}>
      {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={create} className="quote-form">
      <h2>New quote</h2>
      <label>Number <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="QT-001" /></label>
      <label>Branch <select value={effectiveBranchId} onChange={(event) => setBranchId(event.target.value)}>
        {option.companyPermissions.canCreate && <option value="">Company wide</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <label>Customer <select name="customerId" required defaultValue="" key={`${selected}:${effectiveBranchId}:${customers.length}`}>
        <option value="" disabled>Choose customer</option>
        {availableCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}
      </select></label>
      <label>Notes <input name="notes" maxLength={2000} /></label>
      <h3>Items · {option.currency}</h3>
      {lines.map((line, index) => <div className="quote-line" key={index}>
        <input aria-label={`Description ${index + 1}`} placeholder="Description" required minLength={2} maxLength={300}
          value={line.description} onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
        <input aria-label={`Quantity ${index + 1}`} type="number" min="1" max="100000" required value={line.quantity}
          onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} />
        <input aria-label={`Unit price ${index + 1}`} placeholder="Unit price" inputMode="decimal" required
          pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?" value={line.unitPrice}
          onChange={(event) => setLines((current) => current.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} />
        {lines.length > 1 && <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>Remove</button>}
      </div>)}
      {lines.length < 50 && <button type="button" onClick={() => setLines((current) => [...current, { description: "", quantity: "1", unitPrice: "0.000" }])}>Add item</button>}
      <button disabled={busy || availableCustomers.length === 0}>Create quote</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>Quotes</h2>
    {quotes.length === 0 && <p>No quotes on this page.</p>}
    <div className="customer-list">{quotes.map((quote) => {
      const permissions = quote.branchId ? option.branches.find((branch) => branch.id === quote.branchId) : option.companyPermissions;
      return <article key={quote.id}>
      <div><h3>{quote.number} · {quote.customer.displayName}</h3><p>{quote.status} · {quote.subtotal} {quote.currency}</p>
        <ul>{quote.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {quote.status === "DRAFT" && permissions?.canSend && <button disabled={busy}
          onClick={() => void transition(quote, "send")}>Mark as sent</button>}
        {quote.status === "SENT" && permissions?.canDecide && <div className="quote-actions">
          <button disabled={busy} onClick={() => void transition(quote, "accept")}>Mark accepted</button>
          <button disabled={busy} onClick={() => void transition(quote, "reject")}>Mark rejected</button>
        </div>}
      </div>
    </article>})}</div>
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
