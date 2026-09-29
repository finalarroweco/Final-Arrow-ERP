"use client";

import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canManage: boolean; canStockAdjust: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string;
  companyPermissions: Rights; branches: ({ id: string; name: string } & Rights)[] };
type Supplier = { id: string; displayName: string; branchId: string | null };
type Order = { id: string; number: string; supplierName: string; branchId: string | null;
  status: "DRAFT" | "ISSUED" | "RECEIVED" | "CANCELLED"; currency: string; subtotal: string;
  receipt: { id: string; branchId: string } | null;
  lines: { id: string; description: string; quantity: number; unitPrice: string; amount: string }[] };
type Item = { id: string; sku: string; name: string; unit: string };

export function PurchaseOrdersWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [receiptBranchId, setReceiptBranchId] = useState("");
  const [receiptItems, setReceiptItems] = useState<Item[]>([]);
  const [lines, setLines] = useState([{ description: "", quantity: 1, unitPrice: "0.000" }]);
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/purchase-orders?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load purchase orders"); return; }
    setOrders(data.orders); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  useEffect(() => {
    const scope = options[selected];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId });
    void fetch(`/api/suppliers?${query}`).then(async (response) => {
      if (response.ok) setSuppliers((await response.json()).suppliers);
      else setSuppliers([]);
    });
  }, [options, selected]);
  const scope = options[selected];
  const effectiveBranchId = branchId || (!scope?.companyPermissions.canCreate
    ? scope?.branches.find((branch) => branch.canCreate)?.id ?? "" : "");
  const rights = effectiveBranchId ? scope?.branches.find((branch) => branch.id === effectiveBranchId) : scope?.companyPermissions;
  const availableSuppliers = suppliers.filter((supplier) => effectiveBranchId
    ? supplier.branchId === effectiveBranchId || supplier.branchId === null : supplier.branchId === null);
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: effectiveBranchId || null,
          supplierId, number: form.get("number"), notes: form.get("notes") || null, lines }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not create purchase order");
      else { (event.target as HTMLFormElement).reset(); setLines([{ description: "", quantity: 1, unitPrice: "0.000" }]);
        await load(selected); }
    } finally { setBusy(false); }
  }
  async function change(order: Order, action: "issue" | "cancel") {
    if (!scope) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${order.id}/status`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: scope.tenantId, action }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not update purchase order");
      else await load(selected, page);
    } finally { setBusy(false); }
  }
  async function selectReceiptBranch(order: Order, targetBranchId: string) {
    if (!scope) return;
    setReceivingId(order.id); setReceiptBranchId(targetBranchId); setReceiptItems([]); setError("");
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      branchId: targetBranchId });
    const response = await fetch(`/api/inventory/stock?${query}`);
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "Could not load inventory items");
    else setReceiptItems(data.items);
  }
  async function receive(event: React.FormEvent<HTMLFormElement>, order: Order) {
    event.preventDefault();
    if (!scope || !receiptBranchId) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/purchase-orders/${order.id}/receive`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, branchId: receiptBranchId,
          lines: order.lines.map((line) => ({ orderLineId: line.id, itemId: values.get(line.id) })) }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not receive purchase order");
      else { setReceivingId(null); setReceiptItems([]); await load(selected, page); }
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>No accessible companies yet.</p></section>;
  return <section><label>Company <select value={selected} onChange={(event) => {
    setSelected(Number(event.target.value)); setBranchId(""); setSupplierId(""); setSuppliers([]); setOrders([]);
    setReceivingId(null); setReceiptItems([]);
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.companyId}`} value={index}>{option.label}</option>)}</select></label>
    {rights?.canCreate && <form onSubmit={(event) => void create(event)} className="branchform">
      <h2>New purchase order</h2>
      <label>Scope <select value={effectiveBranchId} onChange={(event) => { setBranchId(event.target.value); setSupplierId(""); }}>
        {scope.companyPermissions.canCreate && <option value="">Company-wide</option>}
        {scope.branches.filter((branch) => branch.canCreate).map((branch) =>
          <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <label>Supplier <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
        <option value="">Choose supplier</option>{availableSuppliers.map((supplier) =>
          <option key={supplier.id} value={supplier.id}>{supplier.displayName}</option>)}</select></label>
      <input name="number" placeholder="PO number, e.g. PO-001" required pattern="[A-Z0-9-]{2,30}" />
      <textarea name="notes" placeholder="Notes" maxLength={2000} />
      {lines.map((line, index) => <div key={index} className="formrow">
        <input aria-label={`Item ${index + 1}`} placeholder="Item or service" required minLength={2} maxLength={300}
          value={line.description} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, description: event.target.value } : item))} />
        <input aria-label="Quantity" type="number" min={1} max={100000} required value={line.quantity}
          onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: Number(event.target.value) } : item))} />
        <input aria-label="Unit price" placeholder="Unit price" required pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"
          value={line.unitPrice} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, unitPrice: event.target.value } : item))} />
        {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>Remove</button>}
      </div>)}
      {lines.length < 50 && <button type="button" onClick={() => setLines([...lines, { description: "", quantity: 1, unitPrice: "0.000" }])}>Add line</button>}
      <button type="submit" disabled={busy || !supplierId}>Create draft · {scope.currency}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <div className="customer-list">{orders.map((order) => {
      const canManage = order.branchId ? scope.branches.find((branch) => branch.id === order.branchId)?.canManage
        : scope.companyPermissions.canManage;
      const receiptBranches = scope.branches.filter((branch) => branch.canStockAdjust);
      const canReceive = canManage && (order.branchId
        ? receiptBranches.some((branch) => branch.id === order.branchId) : receiptBranches.length > 0);
      return <article key={order.id}><div><h3>{order.number} · {order.supplierName}</h3>
        <p>{order.status} · {order.subtotal} {order.currency}</p>
        <ul>{order.lines.map((line, index) => <li key={index}>{line.description} · {line.quantity} × {line.unitPrice} = {line.amount}</li>)}</ul>
        {order.receipt && <p>Received into {scope.branches.find((branch) => branch.id === order.receipt?.branchId)?.name ?? "branch"}</p>}
        {canManage && <div className="quote-actions">
          {order.status === "DRAFT" && <><button disabled={busy} onClick={() => void change(order, "issue")}>Mark issued</button>
            <button disabled={busy} onClick={() => void change(order, "cancel")}>Cancel</button></>}
          {order.status === "ISSUED" && canReceive && <button disabled={busy} onClick={() => {
            const target = order.branchId ?? receiptBranches[0].id;
            if (receivingId === order.id) setReceivingId(null);
            else void selectReceiptBranch(order, target);
          }}>Receive into stock</button>}
        </div>}
        {receivingId === order.id && <form className="branchform" onSubmit={(event) => void receive(event, order)}>
          <h4>Goods receipt · map every order line to an item</h4>
          {!order.branchId && <label>Receiving branch <select value={receiptBranchId}
            onChange={(event) => void selectReceiptBranch(order, event.target.value)}>
            {receiptBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>}
          {order.lines.map((line) => <label key={line.id}>{line.description} · {line.quantity} units
            <select name={line.id} required defaultValue=""><option value="">Choose inventory item</option>
              {receiptItems.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}
            </select></label>)}
          <button disabled={busy || !receiptItems.length}>Record full receipt</button>
        </form>}
      </div></article>;
    })}</div>
    {!orders.length && <p>No purchase orders on this page.</p>}
    {page > 0 && <button onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
