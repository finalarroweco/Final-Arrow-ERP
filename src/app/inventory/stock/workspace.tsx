"use client";

import {StockReport} from "./report";
import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Option = { tenantId: string; companyId: string; branchId: string; label: string; canAdjust: boolean };
type Item = { id: string; sku: string; name: string; unit: string };
type Balance = { itemId: string; quantity: string;
  item: { sku: string; name: string; unit: string; archivedAt: string | null } };
type Movement = { id: string; type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT"; delta: string;
  reason: string; createdAt: string; balance: { item: Item } };

export function StockWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [reportVersion,setReportVersion]=useState(0);
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
    if (!response.ok) { setError(data.error ?? t("Could not load stock", "تعذر تحميل المخزون")); return; }
    setItems(data.items); setBalances(data.balances); setMovements(data.movements); setError("");
  }, [options, t]);
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
      if (!response.ok) setError(data.error ?? t("Could not adjust stock", "تعذر تعديل المخزون"));
      else {setReportVersion(value=>value+1); form.reset(); await load(selected); }
    } finally { setBusy(false); }
  }
  if (!options.length) return <section><p>{t("No accessible branches yet. Create a branch and assign stock permissions first.", "لا توجد فروع متاحة. أنشئ فرعاً وامنح صلاحيات المخزون أولاً.")}</p></section>;
  return <section><label>{t("Branch", "الفرع")} <select value={selected} onChange={(event) => {
    setSelected(Number(event.target.value)); setItems([]); setBalances([]); setMovements([]);
  }}>{options.map((option, index) => <option key={`${option.tenantId}:${option.branchId}`} value={index}>{option.label}</option>)}</select></label>
    {scope.canAdjust && <form onSubmit={(event) => void adjust(event)} className="crm-form">
      <h2>{t("Manual adjustment", "تسوية يدوية")}</h2>
      <select name="itemId" required defaultValue=""><option value="">{t("Choose item", "اختر صنفاً")}</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} ({item.unit})</option>)}</select>
      <select name="action"><option value="in">{t("Add stock", "إضافة للمخزون")}</option><option value="out">{t("Remove stock", "سحب من المخزون")}</option></select>
      <input name="quantity" required inputMode="decimal" pattern="(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?"
        placeholder={t("Quantity, e.g. 2.500", "الكمية، مثال 2.500")} />
      <input name="reason" required minLength={3} maxLength={200} placeholder={t("Reason for adjustment", "سبب التسوية")} />
      <button disabled={busy || !items.length}>{t("Record adjustment", "تسجيل التسوية")}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <StockReport key={`${scope.branchId}:${reportVersion}`} scope={{tenantId:scope.tenantId,companyId:scope.companyId,branchId:scope.branchId}} items={[...new Map([...items,...balances.map(balance=>({id:balance.itemId,...balance.item}))].map(item=>[item.id,item])).values()]} locale={locale}/>
    <h2>{t("Balances", "الأرصدة")}</h2><div className="customer-list">{balances.map((balance) => <article key={balance.itemId}>
      <div><h3>{balance.item.name}</h3><p>{balance.item.sku}{balance.item.archivedAt ? t(" · archived", " · مؤرشف") : ""}</p></div>
      <strong>{balance.quantity} {balance.item.unit}</strong>
    </article>)}</div>{!balances.length && <p>{t("No stock balances recorded in this branch.", "لا توجد أرصدة مسجلة لهذا الفرع.")}</p>}
    <h2>{t("Recent movements", "الحركات الأخيرة")}</h2><div className="customer-list">{movements.map((movement) => <article key={movement.id}>
      <div><h3>{movement.balance.item.name}</h3><p>{movement.reason} · {new Date(movement.createdAt).toLocaleString()}</p></div>
      <strong>{movement.delta} {movement.balance.item.unit}</strong>
    </article>)}</div>{!movements.length && <p>{t("No movements yet.", "لا توجد حركات بعد.")}</p>}
  </section>;
}
