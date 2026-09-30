import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { InvoicesWorkspace } from "./workspace";

export default async function InvoicesPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "invoice:read" });
    if (visible === false) return null;
    const rights = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "invoice:create" }),
      canIssue: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "invoice:issue" }),
      canVoid: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "invoice:void" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      companyPermissions: await rights(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await rights(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/sales/orders">{t("Sales orders", "طلبات البيع")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("ACCOUNTING", "المحاسبة")}</p><h1>{t("Invoices.", "الفواتير.")}</h1><p className="sub">{t("Internal billing records from completed sales orders.", "سجلات الفوترة الداخلية للطلبات المكتملة.")}</p></section>
    <InvoicesWorkspace options={options} locale={locale} />
  </main>;
}
