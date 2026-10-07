import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { PurchaseOrdersWorkspace } from "./workspace";

export default async function PurchaseOrdersPage() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "purchase-order:read" });
    if (visible === false) return null;
    const permissions = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "purchase-order:create" }),
      canManage: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "purchase-order:manage" }),
      canStockAdjust: branchId ? await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "inventory-stock:adjust" }) : false,
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      currency: company.baseCurrency, companyPermissions: await permissions(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await permissions(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/purchasing/returns">{t("Stock returns", "مرتجعات المخزون")}</a><a href="/purchasing/receipts">{t("Goods receipts", "استلام البضائع")}</a><a href="/purchasing/suppliers">{t("Suppliers", "الموردون")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("PURCHASING", "المشتريات")}</p><h1>{t("Purchase orders.", "أوامر الشراء.")}</h1><p className="sub">{t("Supplier orders with branch access and tracked status.", "أوامر الموردين مع صلاحيات الفروع ومتابعة الحالة.")}</p></section>
    <PurchaseOrdersWorkspace options={options} locale={locale} />
  </main>;
}

