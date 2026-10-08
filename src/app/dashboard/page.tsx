import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readableCompanyPermissions } from "@/lib/access";
import { db } from "@/lib/db";
import { DashboardWorkspace } from "./workspace";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { ModuleLauncher } from "./module-launcher";
import { LanguageSwitcher } from "../language-switcher";

export default async function DashboardPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const access = await readableCompanyPermissions({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permissions: ["customer:read", "lead:read", "quote:read", "order:read",
        "project:read", "employee:read", "expense:read", "ticket:read"] });
    if (Object.values(access).every((value) => value === false)) return null;
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}` };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><div className="header-actions"><LanguageSwitcher locale={locale} /><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></div></header>
    <section className="hero"><p>{t("OVERVIEW", "نظرة عامة")}</p><h1>{t("Dashboard.", "لوحة المعلومات.")}</h1><p className="sub">{t("Live company activity within your access scope.", "نشاط الشركة المباشر ضمن صلاحياتك.")}</p></section>
    <ModuleLauncher locale={locale} />
    <DashboardWorkspace options={options} locale={locale} />
  </main>;
}
