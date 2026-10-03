"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canArchive: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Supplier = { id: string; code: string; displayName: string; legalName: string | null;
  email: string | null; phone: string | null; notes: string | null; branchId: string | null;
  archivedAt: string | null };

export function SuppliersWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
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
    const response = await fetch(`/api/suppliers?${query}`);
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not load suppliers", "تعذر تحميل الموردين")); return; }
    setSuppliers(data.suppliers); setPage(pageNumber); setNextPage(data.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected, 0, archived); }, [load, selected, archived]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!option) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/suppliers", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
        branchId: values.get("branchId") || null, code: String(values.get("code")).toUpperCase(),
        displayName: values.get("displayName"), legalName: values.get("legalName") || null,
        email: values.get("email") || null, phone: values.get("phone") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not add supplier", "تعذر إضافة المورد")); return; }
    form.reset(); setArchived(false); await load(selected);
  }
  async function update(event: FormEvent<HTMLFormElement>, supplier: Supplier) {
    event.preventDefault();
    if (!option) return;
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "update", displayName: values.get("displayName"),
        legalName: values.get("legalName") || null, email: values.get("email") || null,
        phone: values.get("phone") || null, notes: values.get("notes") || null }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not update supplier", "تعذر تحديث المورد")); return; }
    setEditing(null); await load(selected, page, archived);
  }
  async function archive(supplier: Supplier) {
    if (!option) return;
    const response = await fetch(`/api/suppliers/${supplier.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "archive", archived: !supplier.archivedAt }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? t("Could not change supplier status", "تعذر تغيير حالة المورد")); return; }
    await load(selected, page, archived);
  }
  if (!option) return <section><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section><label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setEditing(null); }}>
    {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
  </select></label>
    {error && <p role="alert">{error}</p>}
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form onSubmit={(event) => void create(event)} className="crm-form">
      <h2>{t("Add supplier", "إضافة مورد")}</h2>
      <input name="code" required pattern="[A-Za-z0-9-]{2,30}" maxLength={30} placeholder={t("Supplier code", "رمز المورد")} />
      <input name="displayName" required minLength={2} maxLength={160} placeholder={t("Supplier name", "اسم المورد")} />
      <input name="legalName" maxLength={200} placeholder={t("Legal name (optional)", "الاسم القانوني (اختياري)")} />
      <input name="email" type="email" placeholder={t("Email (optional)", "البريد الإلكتروني (اختياري)")} />
      <input name="phone" maxLength={40} placeholder={t("Phone (optional)", "الهاتف (اختياري)")} />
      <select name="branchId" required={!option.companyPermissions.canCreate}>
        {option.companyPermissions.canCreate && <option value="">{t("Company-wide", "على مستوى الشركة")}</option>}
        {!option.companyPermissions.canCreate && <option value="">{t("Select branch", "اختر الفرع")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select><button>{t("Add supplier", "إضافة مورد")}</button>
    </form>}
    <div className="formrow"><h2>{t("Supplier records", "سجلات الموردين")}</h2><button type="button" onClick={() => { setArchived(!archived); setEditing(null); }}>
      {archived ? t("Show active", "عرض النشطين") : t("Show archived", "عرض المؤرشفين")}</button></div>
    <div className="customer-list">{suppliers.map((supplier) => {
      const branch = option.branches.find((item) => item.id === supplier.branchId);
      const permissions = supplier.branchId ? branch : option.companyPermissions;
      return <article key={supplier.id}>{editing === supplier.id ?
        <form className="crm-form" onSubmit={(event) => void update(event, supplier)}>
          <input name="displayName" defaultValue={supplier.displayName} required minLength={2} maxLength={160} />
          <input name="legalName" defaultValue={supplier.legalName ?? ""} maxLength={200} />
          <input name="email" type="email" defaultValue={supplier.email ?? ""} />
          <input name="phone" defaultValue={supplier.phone ?? ""} maxLength={40} />
          <input name="notes" defaultValue={supplier.notes ?? ""} maxLength={2000} />
          <button>{t("Save", "حفظ")}</button><button type="button" onClick={() => setEditing(null)}>{t("Cancel", "إلغاء")}</button>
        </form> : <><div><h3>{supplier.displayName}</h3>
          <p>{supplier.code} · {branch?.name ?? t("Company-wide", "على مستوى الشركة")}</p><p>{supplier.email ?? ""} {supplier.phone ?? ""}</p></div>
          <div className="customer-actions">
            {permissions?.canUpdate && !supplier.archivedAt && <button onClick={() => setEditing(supplier.id)}>{t("Edit", "تعديل")}</button>}
            {permissions?.canArchive && <button onClick={() => void archive(supplier)}>{supplier.archivedAt ? t("Restore", "استعادة") : t("Archive", "أرشفة")}</button>}
          </div></>}
      </article>;
    })}</div>
    {!suppliers.length && <p>{t("No suppliers on this page.", "لا يوجد موردون في هذه الصفحة.")}</p>}
    <div className="formrow">{page > 0 && <button onClick={() => void load(selected, page - 1, archived)}>{t("Previous", "السابق")}</button>}
      {nextPage !== null && <button onClick={() => void load(selected, nextPage, archived)}>{t("Next", "التالي")}</button>}</div>
  </section>;
}
