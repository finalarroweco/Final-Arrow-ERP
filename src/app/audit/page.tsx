import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { AuditWorkspace } from "./workspace";

export default async function AuditPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { tenant: true } });
  const options = (await Promise.all(memberships.map(async ({ tenant }) =>
    await canAccess({ userId: user.id, tenantId: tenant.id, permission: "user:manage" }) ? { id: tenant.id, name: tenant.name } : null)))
    .filter((option) => option !== null);
  const locale = await getLocale(); const t = (en: string, ar: string) => translate(locale, en, ar);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("ADMINISTRATION", "الإدارة")}</p><h1>{t("Activity history.", "سجل العمليات.")}</h1><p className="sub">{t("Review recorded changes across your organization.", "راجع التغييرات المسجلة في مؤسستك.")}</p></section>
    <AuditWorkspace options={options} locale={locale} /></main>;
}
