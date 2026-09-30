"use client";

import { translate, type Locale } from "@/lib/locale";
import { useState, type FormEvent } from "react";

type Company = { id: string; name: string; branches: { id: string; name: string }[] };

export function InviteForm({ tenantId, companies, locale }: { tenantId: string; companies: Company[]; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [type, setType] = useState<"TENANT" | "COMPANY" | "BRANCH">("TENANT");
  const [companyId, setCompanyId] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const selected = companies.find((company) => company.id === companyId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setLink("");
    const form = new FormData(event.currentTarget);
    const scope = type === "TENANT" ? { type } : type === "COMPANY"
      ? { type, companyId } : { type, companyId, branchId: String(form.get("branchId") ?? "") };
    const response = await fetch("/api/invitations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, email: form.get("email"), role: form.get("role"), scope }),
    });
    if (!response.ok) { setError(t("Could not create the invitation. Check the selected scope.", "تعذر إنشاء الدعوة. تحقق من نطاق الصلاحية.")); return; }
    const result: { path: string } = await response.json();
    setLink(window.location.origin + result.path);
    window.dispatchEvent(new Event("erp:invitation-created"));
  }

  return <section className="invite-panel">
    <h3>{t("Invite a team member", "دعوة عضو للفريق")}</h3>
    <form onSubmit={submit} className="formrow">
      <input name="email" type="email" placeholder={t("Work email", "البريد المهني")} required />
      <select name="role" aria-label={t("Role", "الدور")}><option value="Viewer">{t("Viewer", "مشاهد")}</option><option value="Manager">{t("Manager", "مدير")}</option></select>
      <select value={type} onChange={(e) => { setType(e.target.value as typeof type); setCompanyId(""); }} aria-label={t("Scope", "النطاق")}>
        <option value="TENANT">{t("Entire organization", "المؤسسة كاملة")}</option>
        <option value="COMPANY">{t("One company", "شركة واحدة")}</option>
        <option value="BRANCH">{t("One branch", "فرع واحد")}</option>
      </select>
      {type !== "TENANT" && <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required aria-label={t("Company", "الشركة")}>
        <option value="">{t("Select company", "اختر الشركة")}</option>
        {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
      </select>}
      {type === "BRANCH" && <select name="branchId" required aria-label={t("Branch", "الفرع")} key={companyId}>
        <option value="">{t("Select branch", "اختر الفرع")}</option>
        {selected?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select>}
      <button type="submit">{t("Create invitation", "إنشاء الدعوة")}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {link && <p>{t("Share this one-time link securely with the invited person. It expires in seven days.", "شارك هذا الرابط لمرة واحدة مع المدعو بشكل آمن. تنتهي صلاحيته بعد سبعة أيام.")}<br /><a href={link}>{link}</a></p>}
  </section>;
}
