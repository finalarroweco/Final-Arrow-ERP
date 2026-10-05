import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readableCompanyPermissions } from "@/lib/access";
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
    const grants = await readableCompanyPermissions({userId:user.id,tenantId:tenant.id,companyId:company.id,
      permissions:["payroll:read","payroll:create","payroll:approve","payroll:pay","payroll:void","ledger:read","ledger:post"]});
    const visible = grants["payroll:read"];
    if (visible === false) return null;
    const allowed = (permission: string, branchId?: string) => grants[permission] === null ||
      Boolean(branchId && Array.isArray(grants[permission]) && (grants[permission] as string[]).includes(branchId));
    const rights = (branchId?: string) => ({
      canPostLedger: allowed("ledger:read",branchId) && allowed("ledger:post",branchId),
      canCreate: allowed("payroll:create",branchId), canApprove: allowed("payroll:approve",branchId),
      canPay: allowed("payroll:pay",branchId), canVoid: allowed("payroll:void",branchId),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      currency: company.baseCurrency, companyRights: rights(),
      branches: company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map((branch) => ({ id: branch.id, name: branch.name, ...rights(branch.id) })) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/accounting/invoices">{t("Invoices", "الفواتير")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("HUMAN RESOURCES", "الموارد البشرية")}</p><h1>{t("Monthly payroll.", "الرواتب الشهرية.")}</h1><p className="sub">{t("Prepare payroll entries, approve, post accrual journals and record payment.", "جهّز سجلات الرواتب واعتمدها ورحّل قيود الاستحقاق وسجّل صرفها.")}</p></section>
    <PayrollWorkspace options={options} locale={locale} />
  </main>;
}
