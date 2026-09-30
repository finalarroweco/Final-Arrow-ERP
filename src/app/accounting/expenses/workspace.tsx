"use client";

import { useCallback, useEffect, useState } from "react";

type Rights = { canCreate: boolean; canPost: boolean; canVoid: boolean };
type Option = { tenantId: string; companyId: string; label: string; currency: string; companyRights: Rights;
  branches: ({ id: string; name: string } & Rights)[] };
type Expense = { id: string; number: string; description: string; category: string; amount: string;
  currency: string; expenseDate: string; status: "DRAFT" | "POSTED" | "VOID";
  branchId: string | null; voidReason: string | null };

export function ExpensesWorkspace({ options }: { options: Option[] }) {
  const [selected, setSelected] = useState(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = options[selected];
  const load = useCallback(async (index: number, number = 0) => {
    const option = options[index];
    if (!option) return;
    const query = new URLSearchParams({ tenantId: option.tenantId, companyId: option.companyId, page: String(number) });
    const response = await fetch(`/api/expenses?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Could not load expenses"); return; }
    setExpenses(data.expenses); setPage(number); setNextPage(data.nextPage);
  }, [options]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function mutate(url: string, method: "POST" | "PATCH", body: object, success: string, pageNumber = 0) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      setMessage(response.ok ? success : data.error ?? "Action failed");
      if (response.ok) await load(selected, pageNumber);
    } catch { setMessage("Network request failed"); } finally { setBusy(false); }
  }
  if (!scope) return <section className="panel"><p>No accessible companies yet.</p></section>;
  const createBranches = scope.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>Company <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setExpenses([]); setMessage(""); }}>
      {options.map((option, index) => <option key={option.companyId} value={index}>{option.label}</option>)}
    </select></label>
    {(scope.companyRights.canCreate || createBranches.length > 0) && <form action={(form) => mutate("/api/expenses", "POST",
      { tenantId: scope.tenantId, companyId: scope.companyId, branchId: form.get("branchId") || null,
        number: form.get("number"), description: form.get("description"), category: form.get("category"),
        amount: form.get("amount"), expenseDate: form.get("expenseDate") }, "Expense draft created")}>
      <h2>New expense draft</h2>
      <label>Number <input name="number" required pattern="[A-Z0-9-]{2,30}" placeholder="EXP-001" /></label>
      <label>Description <input name="description" required minLength={2} maxLength={300} /></label>
      <label>Category <input name="category" required minLength={2} maxLength={80} placeholder="Travel" /></label>
      <label>Amount ({scope.currency}) <input name="amount" required type="number" min="0.001" max="999999999999999.999" step="0.001" /></label>
      <label>Expense date <input name="expenseDate" required type="date" /></label>
      <label>Branch <select name="branchId">
        {scope.companyRights.canCreate && <option value="">Company wide</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>Create draft</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>Expenses</h2>
    {expenses.length === 0 && <p>No expenses on this page.</p>}
    {expenses.map((expense) => {
      const rights = expense.branchId ? scope.branches.find((branch) => branch.id === expense.branchId) : scope.companyRights;
      return <article key={expense.id} className="card"><strong>{expense.number} · {expense.description}</strong>
        <p>{expense.category} · {expense.amount} {expense.currency} · {expense.expenseDate.slice(0, 10)} · {expense.status} · {expense.branchId ? scope.branches.find((branch) => branch.id === expense.branchId)?.name : "Company wide"}</p>
        {expense.voidReason && <p>Void reason: {expense.voidReason}</p>}
        {rights?.canPost && expense.status === "DRAFT" && <button disabled={busy}
          onClick={() => void mutate(`/api/expenses/${expense.id}/status`, "PATCH",
            { tenantId: scope.tenantId, action: "post" }, "Expense posted", page)}>Post expense</button>}
        {rights?.canVoid && expense.status !== "VOID" && <form action={(form) => mutate(
          `/api/expenses/${expense.id}/status`, "PATCH",
          { tenantId: scope.tenantId, action: "void", reason: form.get("reason") },
          "Expense voided", page)}>
          <label>Void reason <input name="reason" required minLength={3} maxLength={300} /></label>
          <button disabled={busy}>Void expense</button>
        </form>}
      </article>;
    })}
    {page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>Previous</button>}
    {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>Next</button>}
  </section>;
}
