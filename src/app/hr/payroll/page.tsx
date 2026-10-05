import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { PayrollWorkspace } from "./workspace";

export default async function PayrollPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "payroll:read" });
    if (visible === false) return null;
    const rights = async (branchId?: string) => ({
      canPostLedger: (await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "ledger:post" })) &&
        (await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "ledger:read" })),
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "payroll:create" }),
      canApprove: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "payroll:approve" }),
      canPay: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "payroll:pay" }),
      canVoid: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "payroll:void" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      currency: company.baseCurrency, companyRights: await rights(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await rights(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/accounting/invoices">{t("Invoices", "الفواتير")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("HUMAN RESOURCES", "الموارد البشرية")}</p><h1>{t("Monthly payroll.", "الرواتب الشهرية.")}</h1><p className="sub">{t("Prepare manual payroll entries, approve and record payment.", "جهّز سجلات الرواتب يدوياً واعتمدها وسجّل صرفها.")}</p></section>
    <PayrollWorkspace options={options} locale={locale} />
  </main>;
}
