import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { intersectBranches } from "@/lib/approval-scope";
import { db } from "@/lib/db";
import { ApprovalsWorkspace } from "./workspace";

export default async function ApprovalsPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const permissions = await Promise.all(["leave:read", "leave:decide", "expense:read", "expense:post",
      "purchase-order:read", "purchase-order:manage"].map((permission) =>
      readableCompanyBranches({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission })));
    if ([intersectBranches(permissions[0], permissions[1]), intersectBranches(permissions[2], permissions[3]),
      intersectBranches(permissions[4], permissions[5])].every((value) => value === false)) return null;
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      branches: company.branches.map((branch) => ({ id: branch.id, name: branch.name })) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("APPROVALS", "الموافقات")}</p><h1>{t("Action inbox.", "صندوق الإجراءات.")}</h1><p className="sub">{t("Review leave, expense drafts and purchase orders from one place.", "راجع الإجازات ومسودات المصاريف وأوامر الشراء من مكان واحد.")}</p></section>
    <ApprovalsWorkspace options={options} locale={locale} />
  </main>;
}
