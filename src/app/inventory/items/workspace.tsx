"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Item = { id: string; sku: string; name: string; unit: string; description: string | null;
  branchId: string | null; archivedAt: string | null };

export function ItemsWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0, showArchived = false) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId,
      page: String(pageNumber), archived: String(showArchived) });
    const response = await fetch(`/api/inventory/items?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not load items", "تعذر تحميل الأصناف")); return; }
    setItems(data.items); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected, 0, archived); }, [load, selected, archived]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!option) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/inventory/items", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
        branchId: values.get("branchId") || null, sku: String(values.get("sku")).toUpperCase(),
        name: values.get("name"), unit: values.get("unit"), description: values.get("description") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not add item", "تعذر إضافة الصنف")); return; }
    form.reset(); setArchived(false); await load(selected);
  }
  async function update(event: FormEvent<HTMLFormElement>, item: Item) {
    event.preventDefault();
    if (!option) return;
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/inventory/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "update", name: values.get("name"),
        unit: values.get("unit"), description: values.get("description") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not update item", "تعذر تحديث الصنف")); return; }
    setEditing(null); await load(selected, page, archived);
  }
  async function archive(item: Item) {
    if (!option) return;
    const response = await fetch(`/api/inventory/items/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "archive", archived: !item.archivedAt }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not change item status", "تعذر تغيير حالة الصنف")); return; }
    await load(selected, page, archived);
  }
  if (!option) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section><label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setEditing(null); }}>
    {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form onSubmit={(event) => void create(event)} className="crm-form">
      <h2>{t("Add item", "إضافة صنف")}</h2>
      <input name="sku" required pattern="[A-Za-z0-9-]{2,40}" maxLength={40} placeholder="SKU" />
      <input name="name" required minLength={2} maxLength={160} placeholder={t("Item name", "اسم الصنف")} />
      <input name="unit" required pattern="[A-Za-z0-9-]{1,16}" maxLength={16} defaultValue="EA" placeholder={t("Unit (EA, KG, L)", "الوحدة (EA، KG، L)")} />
      <input name="description" maxLength={1000} placeholder={t("Description (optional)", "الوصف (اختياري)")} />
      <select name="branchId" required={!option.companyPermissions.canCreate}>
        {option.companyPermissions.canCreate && <option value="">{t("Company-wide", "على مستوى الشركة")}</option>}
        {!option.companyPermissions.canCreate && <option value="">{t("Select branch", "اختر الفرع")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select><button>{t("Add item", "إضافة صنف")}</button>
    </form>}
    <div className="formrow"><h2>{t("Item records", "سجلات الأصناف")}</h2><button type="button" onClick={() => { setArchived(!archived); setEditing(null); }}>
      {archived ? t("Show active", "عرض النشطين") : t("Show archived", "عرض المؤرشفين")}</button></div>
    <div className="customer-list">{items.map((item) => {
      const branch = option.branches.find((entry) => entry.id === item.branchId);
      const permissions = item.branchId ? branch : option.companyPermissions;
      return <article key={item.id}>{editing === item.id ?
        <form className="crm-form" onSubmit={(event) => void update(event, item)}>
          <input name="name" defaultValue={item.name} required minLength={2} maxLength={160} />
          <input name="unit" defaultValue={item.unit} required pattern="[A-Za-z0-9-]{1,16}" maxLength={16} />
          <input name="description" defaultValue={item.description ?? ""} maxLength={1000} />
          <button>{t("Save", "حفظ")}</button><button type="button" onClick={() => setEditing(null)}>{t("Cancel", "إلغاء")}</button>
        </form> : <><div><h3>{item.name}</h3>
          <p>{item.sku} · {item.unit} · {branch?.name ?? t("Company-wide", "على مستوى الشركة")}</p><p>{item.description ?? ""}</p></div>
          <div className="customer-actions">
            {permissions?.canUpdate && !item.archivedAt && <button onClick={() => setEditing(item.id)}>{t("Edit", "تعديل")}</button>}
            {permissions?.canArchive && <button onClick={() => void archive(item)}>{item.archivedAt ? t("Restore", "استعادة") : t("Archive", "أرشفة")}</button>}
          </div></>}
      </article>;
    })}</div>
    {!items.length && <p>{t("No items on this page.", "لا توجد أصناف في هذه الصفحة.")}</p>}
    <div className="formrow">{page > 0 && <button onClick={() => void load(selected, page - 1, archived)}>{t("Previous", "السابق")}</button>}
      {nextPage !== null && <button onClick={() => void load(selected, nextPage, archived)}>{t("Next", "التالي")}</button>}</div>
  </section>;
}
