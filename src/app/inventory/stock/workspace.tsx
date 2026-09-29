"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Option = { tenantId: string; companyId: string; branchId: string; label: string; canAdjust: boolean };
type Item = { id: string; sku: string; name: string; unit: string };
type Balance = { itemId: string; quantity: string;
  item: { sku: string; name: string; unit: string; archivedAt: string | null } };
type Movement = { id: string; type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"; delta: string;
  reason: string; createdAt: string; balance: { item: Item } };

export function StockWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number) => {
    const branch = options[index];
    if (!branch) return;
    const query = new URLSearchParams({ tenantId: branch.tenantId, companyId: branch.companyId,
      branchId: branch.branchId });
    const response = await fetch(`/api/inventory/stock?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Could not load stock"); return; }
    setItems(data.items); setBalances(data.balances); setMovements(data.movements); setError("");
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scope) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/inventory/stock", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: scope.tenantId, companyId: scope.companyId, branchId: scope.branchId,
          itemId: values.get("itemId"), action: values.get("action"), quantity: values.get("quantity"),
          reason: values.get("reason") }) });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not adjust stock");
      else { form.reset(); await load(selected); }
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>No accessible branches yet. Create a branch and assign stock permissions first.</p></section>;
  return <section><label>Branch <select value={selected} onChange={(event) => {
    setSelected(Number(event.target.value)); setItems([]); setBalances([]); setMovements([]);
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.branchId}`} value={index}>{option.label}</option>)}</select></label>
    {scope.canAdjust && <form onSubmit={(event) => void adjust(event)} className="crm-form">
      <h2>Manual adjustment</h2>
      <select name="itemId" required defaultValue=""><option value="">Choose item</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}</select>
      <select name="action"><option value="in">Add stock</option><option value="out">Remove stock</option></select>
      <input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"
        placeholder="Quantity, e.g. 2.500" />
      <input name="reason" required minLength={3} maxLength={200} placeholder="Reason for adjustment" />
      <button disabled={busy || !items.length}>Record adjustment</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <h2>Balances</h2><div className="customer-list">{balances.map((balance) => <article key={balance.itemId}>
      <div><h3>{balance.item.name}</h3><p>{balance.item.sku}{balance.item.archivedAt ? " · archived" : ""}</p></div>
      <strong>{balance.quantity} {balance.item.unit}</strong>
    </article>)}</div>{!balances.length && <p>No stock balances recorded in this branch.</p>}
    <h2>Recent movements</h2><div className="customer-list">{movements.map((movement) => <article key={movement.id}>
      <div><h3>{movement.balance.item.name}</h3><p>{movement.reason} · {new Date(movement.createdAt).toLocaleString()}</p></div>
      <strong>{movement.delta} {movement.balance.item.unit}</strong>
    </article>)}</div>{!movements.length && <p>No movements yet.</p>}
  </section>;
}
