import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { SuppliersWorkspace } from "./workspace";

export default async function SuppliersPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "supplier:read" });
    if (visible === false) return null;
    const permissions = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "supplier:create" }),
      canUpdate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "supplier:update" }),
      canArchive: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "supplier:archive" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      companyPermissions: await permissions(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await permissions(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("PURCHASING", "المشتريات")}</p><h1>{t("Suppliers.", "الموردون.")}</h1><p className="sub">{t("Company and branch supplier records.", "سجلات موردي الشركات والفروع.")}</p></section>
    <SuppliersWorkspace options={options} />
  </main>;
}
