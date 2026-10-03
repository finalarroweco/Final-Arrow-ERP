import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { CrmWorkspace, type CompanyOption } from "./workspace";

export default async function CRMPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } },
  });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }): Promise<CompanyOption | null> => {
    const visible = await readableCompanyBranches({
      userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:read",
    });
    if (visible === false) return null;
    const branches = (await Promise.all(company.branches.map(async (branch) => ({
      id: branch.id, name: branch.name,
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:create" }),
      canUpdate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:update" }),
      canArchive: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:archive" }),
    })))).filter((branch) => visible === null || visible.includes(branch.id));
    return {
      tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      branches,
      canCreateCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:create" }),
      canUpdateCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:update" }),
      canArchiveCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:archive" }),
    };
  }))).filter((option): option is CompanyOption => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/crm/leads">{t("Leads", "الفرص البيعية")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>CRM</p><h1>{t("Customers.", "العملاء.")}</h1><p className="sub">{t("Company and branch customer records with scoped access.", "سجلات عملاء الشركات والفروع ضمن صلاحياتك.")}</p></section>
    <CrmWorkspace options={options} locale={locale} />
  </main>;
}
