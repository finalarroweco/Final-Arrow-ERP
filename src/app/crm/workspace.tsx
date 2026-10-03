"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState, type FormEvent } from "react";

export type CompanyOption = {
  tenantId: string; companyId: string; label: string;
  branches: { id: string; name: string; canCreate: boolean; canUpdate: boolean; canArchive: boolean }[];
  canCreateCompanyWide: boolean; canUpdateCompanyWide: boolean; canArchiveCompanyWide: boolean;
};
type Customer = {
  id: string; code: string; displayName: string; legalName: string | null;
  email: string | null; phone: string | null; notes: string | null; branchId: string | null;
  archivedAt: string | null;
};

export function CrmWorkspace({ options, locale }: { options: CompanyOption[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const option = options[selected];

  const load = useCallback(async (index: number, next: number, archived: boolean) => {
    const item = options[index];
    if (!item) return;
    const response = await fetch(`/api/customers?tenantId=${item.tenantId}&companyId=${item.companyId}&page=${next}&archived=${archived}`);
    if (!response.ok) { setError(t("Could not load customers.", "تعذر تحميل العملاء.")); return; }
    const result: { customers: Customer[]; nextPage: number | null } = await response.json();
    setCustomers(result.customers); setPage(next); setNextPage(result.nextPage); setError("");
  }, [options, t]);
  useEffect(() => { void load(selected, 0, showArchived); }, [load, selected, showArchived]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!option) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const response = await fetch("/api/customers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: option.tenantId, companyId: option.companyId,
        branchId: values.get("branchId") || null, code: String(values.get("code")).toUpperCase(),
        displayName: values.get("displayName"), email: values.get("email") || null,
        phone: values.get("phone") || null,
      }),
    });
    if (!response.ok) {
      const result: { error?: string } = await response.json();
      setError(result.error ?? t("Could not add customer.", "تعذر إضافة العميل.")); return;
    }
    form.reset(); setShowArchived(false); await load(selected, 0, false);
  }

  async function update(event: FormEvent<HTMLFormElement>, customer: Customer) {
    event.preventDefault();
    if (!option) return;
    const values = new FormData(event.currentTarget);
    const response = await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "update",
        displayName: values.get("displayName"), email: values.get("email") || null,
        phone: values.get("phone") || null }),
    });
    if (!response.ok) { setError(t("Could not update customer.", "تعذر تحديث العميل.")); return; }
    setEditing(null); await load(selected, page, showArchived);
  }

  async function archive(customer: Customer, archived: boolean) {
    if (!option) return;
    const response = await fetch(`/api/customers/${customer.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: option.tenantId, action: "archive", archived }),
    });
    if (!response.ok) { setError(t("Could not archive customer.", "تعذر تغيير أرشفة العميل.")); return; }
    await load(selected, page, showArchived);
  }

  if (options.length === 0) return <p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p>;
  const canCreate = option.canCreateCompanyWide || option.branches.some((branch) => branch.canCreate);
  return <section>
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(e) => { setSelected(Number(e.target.value)); setEditing(null); }}>
      {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
    </select></label>
    {error && <p role="alert">{error}</p>}
    {canCreate && <form onSubmit={add} className="crm-form">
      <h2>{t("Add customer", "إضافة عميل")}</h2>
      <input name="code" placeholder={t("Customer code", "رمز العميل")} required pattern="[A-Za-z0-9-]{2,30}" maxLength={30} />
      <input name="displayName" placeholder={t("Customer name", "اسم العميل")} required minLength={2} maxLength={160} />
      <input name="email" type="email" placeholder={t("Email (optional)", "البريد الإلكتروني (اختياري)")} />
      <input name="phone" placeholder={t("Phone (optional)", "الهاتف (اختياري)")} maxLength={40} />
      <select name="branchId" required={!option.canCreateCompanyWide}>
        {option.canCreateCompanyWide && <option value="">{t("Company-wide", "على مستوى الشركة")}</option>}
        {!option.canCreateCompanyWide && <option value="">{t("Select branch", "اختر الفرع")}</option>}
        {option.branches.filter((branch) => branch.canCreate).map((branch) =>
          <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>
      <button type="submit">{t("Add customer", "إضافة عميل")}</button>
    </form>}
    <div className="formrow"><h2>{t("Customer records", "سجلات العملاء")}</h2>
      <button type="button" onClick={() => { setShowArchived(!showArchived); setEditing(null); }}>
        {showArchived ? t("Show active", "عرض النشطين") : t("Show archived", "عرض المؤرشفين")}
      </button>
    </div>
    <div className="customer-list">{customers.map((customer) => {
      const branch = option.branches.find((item) => item.id === customer.branchId);
      const canUpdate = customer.branchId ? !!branch?.canUpdate : option.canUpdateCompanyWide;
      const canArchive = customer.branchId ? !!branch?.canArchive : option.canArchiveCompanyWide;
      return <article key={customer.id}>
        {editing === customer.id ? <form onSubmit={(event) => void update(event, customer)} className="crm-form">
          <input name="displayName" defaultValue={customer.displayName} required minLength={2} maxLength={160} />
          <input name="email" type="email" defaultValue={customer.email ?? ""} />
          <input name="phone" defaultValue={customer.phone ?? ""} maxLength={40} />
          <button type="submit">{t("Save", "حفظ")}</button><button type="button" onClick={() => setEditing(null)}>{t("Cancel", "إلغاء")}</button>
        </form> : <>
          <div><h3>{customer.displayName}</h3><p>{customer.code} · {branch?.name ?? t("Company-wide", "على مستوى الشركة")}</p>
            <p>{customer.email ?? ""} {customer.phone ?? ""}</p></div>
          <div className="customer-actions">
            {canUpdate && !customer.archivedAt && <button type="button" onClick={() => setEditing(customer.id)}>{t("Edit", "تعديل")}</button>}
            {canArchive && <button type="button" onClick={() => void archive(customer, !customer.archivedAt)}>
              {customer.archivedAt ? t("Restore", "استعادة") : t("Archive", "أرشفة")}
            </button>}
          </div>
        </>}
      </article>;
    })}</div>
    {customers.length === 0 && <p>{t("No customers in this company yet.", "لا يوجد عملاء في هذه الشركة بعد.")}</p>}
    <div className="formrow">{page > 0 && <button type="button" onClick={() => void load(selected, page - 1, showArchived)}>{t("Previous", "السابق")}</button>}
      {nextPage !== null && <button type="button" onClick={() => void load(selected, nextPage, showArchived)}>{t("Next", "التالي")}</button>}</div>
  </section>;
}
