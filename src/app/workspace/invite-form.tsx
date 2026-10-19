"use client";

import { translate, type Locale } from "@/lib/locale";
import { useState,useEffect,useRef, type FormEvent } from "react";

type Company = { id: string; name: string; branches: { id: string; name: string }[] };

export function InviteForm({ tenantId, companies, locale }: { tenantId: string; companies: Company[]; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [roles,setRoles]=useState<{id:string;name:string;assignable:boolean}[]>([]);
  const [busy,setBusy]=useState(false);const working=useRef(false);
  useEffect(()=>{const controller=new AbortController();void fetch(`/api/roles?tenantId=${tenantId}`,{signal:controller.signal}).then(async r=>{if(r.ok){const data=await r.json();if(!controller.signal.aborted)setRoles(data.roles.filter((r:{assignable:boolean})=>r.assignable));}}).catch(()=>{});return()=>controller.abort();},[tenantId]);
  const [type, setType] = useState<"TENANT" | "COMPANY" | "BRANCH">("TENANT");
  const [companyId, setCompanyId] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const selected = companies.find((company) => company.id === companyId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(working.current)return;working.current=true;setBusy(true);
    try{
    setError(""); setLink("");
    const form = new FormData(event.currentTarget);
    const scope = type === "TENANT" ? { type } : type === "COMPANY"
      ? { type, companyId } : { type, companyId, branchId: String(form.get("branchId") ?? "") };
    const choice=String(form.get("role"));
    const response = await fetch("/api/invitations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, email: form.get("email"), ...(choice==="Manager"||choice==="Viewer"?{role:choice}:{roleId:choice}), scope }),
    });
    if (!response.ok) { setError(t("Could not create the invitation. Check the selected scope.", "تعذر إنشاء الدعوة. تحقق من نطاق الصلاحية.")); return; }
    const result: { path: string } = await response.json();
    setLink(window.location.origin + result.path);
    window.dispatchEvent(new Event("erp:invitation-created"));
    }catch{setError(t("Connection failed. Check pending invitations before retrying.","فشل الاتصال. تحقق من الدعوات المعلّقة قبل إعادة المحاولة."));}finally{working.current=false;setBusy(false);}
  }

  return <section className="invite-panel">
    <h3>{t("Invite a team member", "دعوة عضو للفريق")}</h3>
    <form onSubmit={submit}><fieldset disabled={busy} className="formrow">
      <input name="email" type="email" placeholder={t("Work email", "البريد المهني")} required />
      <select name="role" aria-label={t("Role", "الدور")}><option value="Viewer">{t("Viewer", "مشاهد")}</option><option value="Manager">{t("Manager", "مدير")}</option>{roles.filter(r=>!["Manager","Viewer"].includes(r.name)).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>
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
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {link && <p>{t("Share this one-time link securely with the invited person. It expires in seven days.", "شارك هذا الرابط لمرة واحدة مع المدعو بشكل آمن. تنتهي صلاحيته بعد سبعة أيام.")}<br /><a href={link}>{link}</a></p>}
  </section>;
}

