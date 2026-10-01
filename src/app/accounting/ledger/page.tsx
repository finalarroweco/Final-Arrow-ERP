import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { LedgerWorkspace } from "./workspace";
export default async function LedgerPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  const locale = await getLocale(); const t = (en: string, ar: string) => translate(locale,en,ar);
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const options = (await Promise.all(memberships.flatMap(({ tenant }) => tenant.companies.map(async (company) => {
    const scope = { userId: user.id, tenantId: tenant.id, companyId: company.id };
    const branches = await readableCompanyBranches({ ...scope, permission: "ledger:read" });
    if (branches === false) return null;
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`, currency: company.baseCurrency,
      canManageAccounts: await canAccess({ ...scope, permission: "ledger-account:manage" }), canPost: await canAccess({ ...scope, permission: "ledger:post" }),
      branches: await Promise.all(company.branches.filter((branch) => branches === null || branches.includes(branch.id)).map(async (branch) => ({ id: branch.id, name: branch.name, canPost: await canAccess({ ...scope, branchId: branch.id, permission: "ledger:post" }) }))) };
  })))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/workspace">{t("Workspace", "مساحة العمل")}</a><a href="/accounting/expenses">{t("Expenses", "المصاريف")}</a></header>
    <section className="hero"><p>{t("ACCOUNTING", "المحاسبة")}</p><h1>{t("General ledger.", "دفتر الأستاذ.")}</h1><p className="sub">{t("Chart of accounts, balanced journals and trial balance.", "دليل الحسابات والقيود المتوازنة وميزان المراجعة.")}</p></section>
    <LedgerWorkspace options={options} locale={locale} /></main>;
}
