"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Permissions = { canCreate: boolean; canUpdate: boolean; canConvert: boolean };
type Option = { tenantId: string; companyId: string; label: string; companyPermissions: Permissions;
  branches: ({ id: string; name: string } & Permissions)[] };
type Lead = { id: string; code: string; displayName: string; email: string | null; phone: string | null;
  branchId: string | null; stage: "NEW" | "QUALIFIED" | "PROPOSAL" | "WON" | "LOST";
  convertedCustomerId: string | null };

export function LeadsWorkspace({ options, locale }: { options: Option[]; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [selected, setSelected] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [page, setPage] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const option = options[selected];
  const load = useCallback(async (index: number, pageNumber = 0) => {
    const scope = options[index];
    if (!scope) return;
    const query = new URLSearchParams({ tenantId: scope.tenantId, companyId: scope.companyId, page: String(pageNumber) });
    const response = await fetch(`/api/leads?${query}`);
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? t("Could not load leads", "تعذر تحميل الفرص")); return; }
    setLeads(data.leads); setPage(pageNumber); setNextPage(data.nextPage);
  }, [options, t]);
  useEffect(() => { void load(selected); }, [load, selected]);
  async function create(form: FormData) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: option.tenantId, companyId: option.companyId,
          branchId: form.get("branchId") || null, code: form.get("code"), displayName: form.get("displayName"),
          email: form.get("email") || null, phone: form.get("phone") || null }) });
      const data = await response.json();
      setMessage(response.ok ? t("Lead created", "تم إنشاء الفرصة") : data.error ?? t("Could not create lead", "تعذر إنشاء الفرصة"));
      if (response.ok) await load(selected);
    } finally { setBusy(false); }
  }
  async function change(lead: Lead, action: "stage" | "convert", stage?: Lead["stage"]) {
    if (!option) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/leads/${lead.id}${action === "convert" ? "/convert" : ""}`, {
        method: action === "convert" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "convert"
          ? { tenantId: option.tenantId, customerCode: lead.code }
          : { tenantId: option.tenantId, stage }),
      });
      const data = await response.json();
      setMessage(response.ok ? action === "convert" ? t("Customer created", "تم إنشاء العميل") : t("Stage updated", "تم تحديث المرحلة") : data.error ?? t("Action failed", "تعذر تنفيذ الإجراء"));
      if (response.ok) await load(selected, page);
    } finally { setBusy(false); }
  }
  if (!option) return <section className="panel"><p>{t("No accessible companies yet.", "لا توجد شركات متاحة لك بعد.")}</p></section>;
  const createBranches = option.branches.filter((branch) => branch.canCreate);
  return <section className="panel">
    <label>{t("Company", "الشركة")} <select value={selected} onChange={(event) => { setSelected(Number(event.target.value)); setMessage(""); }}>
      {options.map((item, index) => <option key={`${item.tenantId}:${item.companyId}`} value={index}>{item.label}</option>)}
    </select></label>
    {(option.companyPermissions.canCreate || createBranches.length > 0) && <form action={create}>
      <h2>{t("New lead", "فرصة جديدة")}</h2>
      <label>{t("Code", "الرمز")} <input name="code" required pattern="[A-Z0-9-]{2,30}" placeholder="LEAD-001" /></label>
      <label>{t("Name", "الاسم")} <input name="displayName" required minLength={2} maxLength={160} /></label>
      <label>{t("Email", "البريد الإلكتروني")} <input name="email" type="email" /></label>
      <label>{t("Phone", "الهاتف")} <input name="phone" /></label>
      <label>{t("Branch", "الفرع")} <select name="branchId">
        {option.companyPermissions.canCreate && <option value="">{t("Company wide", "على مستوى الشركة")}</option>}
        {createBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></label>
      <button disabled={busy}>{t("Create lead", "إنشاء فرصة")}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    <h2>{t("Pipeline", "مسار الفرص")}</h2>
    {leads.length === 0 && <p>{t("No leads on this page.", "لا توجد فرص في هذه الصفحة.")}</p>}
    {leads.map((lead) => {
      const permissions = lead.branchId ? option.branches.find((branch) => branch.id === lead.branchId) : option.companyPermissions;
      return <article key={lead.id} className="card"><strong>{lead.displayName}</strong> · {lead.code}
        <p>{t(lead.stage, ({ NEW: "جديدة", QUALIFIED: "مؤهلة", PROPOSAL: "عرض سعر", WON: "مكتسبة", LOST: "مفقودة" })[lead.stage])} {lead.email && `· ${lead.email}`} {lead.phone && `· ${lead.phone}`}</p>
        {lead.stage !== "WON" && <div>
          {permissions?.canUpdate && <select disabled={busy} value={lead.stage} aria-label={`${t("Stage for", "مرحلة")}: ${lead.displayName}`}
            onChange={(event) => void change(lead, "stage", event.target.value as Lead["stage"])}>
            {(["NEW", "QUALIFIED", "PROPOSAL", "LOST"] as const).map((stage) => <option key={stage} value={stage}>{t(stage, ({ NEW: "جديدة", QUALIFIED: "مؤهلة", PROPOSAL: "عرض سعر", LOST: "مفقودة" })[stage])}</option>)}
          </select>}
          {permissions?.canConvert && lead.stage !== "LOST" && <button disabled={busy}
            onClick={() => void change(lead, "convert")}>{t("Convert to customer", "تحويل إلى عميل")}</button>}
        </div>}
        {lead.convertedCustomerId && <p>{t("Customer ID:", "معرّف العميل:")} {lead.convertedCustomerId}</p>}
      </article>;
    })}
    <div>{page > 0 && <button disabled={busy} onClick={() => void load(selected, page - 1)}>{t("Previous", "السابق")}</button>}
      {nextPage !== null && <button disabled={busy} onClick={() => void load(selected, nextPage)}>{t("Next", "التالي")}</button>}</div>
  </section>;
}
