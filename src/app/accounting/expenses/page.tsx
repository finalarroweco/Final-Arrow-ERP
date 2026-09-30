import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { ExpensesWorkspace } from "./workspace";

export default async function ExpensesPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "expense:read" });
    if (visible === false) return null;
    const rights = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "expense:create" }),
      canPost: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "expense:post" }),
      canVoid: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "expense:void" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      currency: company.baseCurrency, companyRights: await rights(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await rights(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/accounting/invoices">{t("Invoices", "الفواتير")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("ACCOUNTING", "المحاسبة")}</p><h1>{t("Expenses.", "المصاريف.")}</h1><p className="sub">{t("Record and review internal company spending.", "سجّل وراجع مصاريف الشركة الداخلية.")}</p></section>
    <ExpensesWorkspace options={options} />
  </main>;
}
