"use client";

import { translate, type Locale } from "@/lib/locale";
import { useCallback, useEffect, useState } from "react";

type Member = {
  id: string; userId: string; name: string; email: string; status: string;
  grants: { role: string; scopes: { type: string; companyId: string | null; branchId: string | null }[] }[];
};
type Invitation = {
  id: string; email: string; role: string; type: string;
  companyId: string | null; branchId: string | null; expiresAt: string;
};

export function TeamPanel({ tenantId, currentUserId, locale }: { tenantId: string; currentUserId: string; locale: Locale }) {
  const t = useCallback((en: string, ar: string) => translate(locale, en, ar), [locale]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/team?tenantId=${tenantId}`);
    if (!response.ok) { setError(t("Could not load the team.", "تعذر تحميل الفريق.")); return; }
    const result: { members: Member[]; invitations: Invitation[] } = await response.json();
    setMembers(result.members); setInvitations(result.invitations); setError("");
  }, [tenantId, t]);

  useEffect(() => {
    void refresh();
    window.addEventListener("erp:invitation-created", refresh);
    return () => window.removeEventListener("erp:invitation-created", refresh);
  }, [refresh]);

  async function changeStatus(member: Member) {
    const status = member.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const response = await fetch(`/api/team/${member.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, status }),
    });
    if (!response.ok) { setError(t("Could not change member status.", "تعذر تغيير حالة العضو.")); return; }
    await refresh();
  }

  async function revoke(invitation: Invitation) {
    const response = await fetch(`/api/invitations/${invitation.id}?tenantId=${tenantId}`, { method: "DELETE" });
    if (!response.ok) { setError(t("Could not revoke invitation.", "تعذر إلغاء الدعوة.")); return; }
    await refresh();
  }

  return <section className="team-panel">
    <h3>{t("Team access", "صلاحيات الفريق")}</h3>
    {error && <p role="alert">{error}</p>}
    <h4>{t("Members", "الأعضاء")}</h4>
    <ul>{members.map((member) => <li key={member.id}>
      <div><strong>{member.name}</strong> · {member.email}<br />
        <small>{member.grants.map((grant) => `${t(grant.role, ({ Owner: "مالك", Manager: "مدير", Viewer: "مشاهد" })[grant.role] ?? grant.role)}: ${grant.scopes.map((scope) => t(scope.type.toLowerCase(), ({ TENANT: "المؤسسة", COMPANY: "الشركة", BRANCH: "الفرع" })[scope.type] ?? scope.type)).join(", ")}`).join(" · ")} · {t(member.status.toLowerCase(), member.status === "ACTIVE" ? "نشط" : "معلق")}</small></div>
      {member.userId !== currentUserId && !member.grants.some((grant) => grant.role === "Owner") &&
        <button type="button" onClick={() => void changeStatus(member)}>
          {member.status === "ACTIVE" ? t("Suspend", "تعليق") : t("Reactivate", "إعادة التفعيل")}
        </button>}
    </li>)}</ul>
    <h4>{t("Pending invitations", "الدعوات المعلقة")}</h4>
    {invitations.length === 0 ? <p>{t("No pending invitations.", "لا توجد دعوات معلقة.")}</p> : <ul>{invitations.map((invitation) => <li key={invitation.id}>
      <div>{invitation.email}<br /><small>{t(invitation.role, ({ Owner: "مالك", Manager: "مدير", Viewer: "مشاهد" })[invitation.role] ?? invitation.role)} · {t(invitation.type.toLowerCase(), ({ TENANT: "المؤسسة", COMPANY: "الشركة", BRANCH: "الفرع" })[invitation.type] ?? invitation.type)} · {t("expires", "تنتهي")} {new Date(invitation.expiresAt).toLocaleDateString(locale === "ar" ? "ar-OM" : "en-GB")}</small></div>
      <button type="button" onClick={() => void revoke(invitation)}>{t("Revoke", "إلغاء الدعوة")}</button>
    </li>)}</ul>}
  </section>;
}
