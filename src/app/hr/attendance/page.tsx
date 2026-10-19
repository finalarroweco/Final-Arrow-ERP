import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { AttendanceWorkspace } from "./workspace";

export default async function AttendancePage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "attendance:read" });
    if (visible === false) return null;
    const canManage = (branchId?: string) => canAccess({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, branchId, permission: "attendance:manage" });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      companyCanManage: await canManage(), branches: await Promise.all(company.branches
        .filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, canManage: await canManage(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/hr/employees">{t("Employees", "الموظفون")}</a><a href="/hr/leave">{t("Leave", "الإجازات")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("HUMAN RESOURCES", "الموارد البشرية")}</p><h1>{t("Daily attendance.", "الحضور اليومي.")}</h1><p className="sub">{t("Enter same-day shifts manually and close open entries.", "أدخل ورديات اليوم يدوياً وأغلق سجلاتها المفتوحة.")}</p></section>
    <AttendanceWorkspace options={options} locale={locale} />
  </main>;
}
