import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { StockWorkspace } from "./workspace";

export default async function StockPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.flatMap((company) =>
    company.branches.map((branch) => ({ tenant, company, branch }))));
  const options = (await Promise.all(candidates.map(async ({ tenant, company, branch }) => {
    const scope = { userId: user.id, tenantId: tenant.id, companyId: company.id, branchId: branch.id };
    if (!(await canAccess({ ...scope, permission: "inventory-stock:read" }))) return null;
    return { tenantId: tenant.id, companyId: company.id, branchId: branch.id,
      label: `${tenant.name} / ${company.name} / ${branch.name}`,
      canAdjust: await canAccess({ ...scope, permission: "inventory-stock:adjust" }) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/inventory/items">{t("Items", "الأصناف")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("INVENTORY", "المخزون")}</p><h1>{t("Branch stock.", "مخزون الفروع.")}</h1><p className="sub">{t("Balances and manual stock adjustments by branch.", "الأرصدة والتسويات اليدوية لكل فرع.")}</p></section>
    <StockWorkspace options={options} locale={locale} />
  </main>;
}
