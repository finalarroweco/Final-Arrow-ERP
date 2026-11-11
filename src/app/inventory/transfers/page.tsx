import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { TransferWorkspace } from "./workspace";
import type { TransferOption } from "./types";

export default async function TransferPage() {
  const user = await currentUser(); if (!user) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { include: { branches: true } } } } } });
  const options: TransferOption[] = [];
  for (const { tenant } of memberships) for (const company of tenant.companies) {
    const branches: TransferOption["branches"] = [];
    for (const branch of company.branches) {
      const scope = { userId: user.id, tenantId: tenant.id, companyId: company.id, branchId: branch.id };
      if (!await canAccess({ ...scope, permission: "inventory-stock:read" })) continue;
      branches.push({ id: branch.id, name: branch.name, canWrite: await canAccess({ ...scope, permission: "inventory-transfer:manage" }) && await canAccess({ ...scope, permission: "inventory-stock:adjust" }) });
    }
    if (branches.length < 2) continue;
    const items = await db.inventoryItem.findMany({ where: { tenantId: tenant.id, companyId: company.id, branchId: null, archivedAt: null }, select: { id: true, name: true, sku: true, unit: true }, orderBy: { name: "asc" } });
    options.push({ tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`, branches, items });
  }
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/inventory/stock">{t("Branch stock", "مخزون الفروع")}</a></header>
    <section className="hero"><h1>{t("Branch transfers", "تحويلات الفروع")}</h1><p>{t("Record stock already transferred between branches. Both balances update together at the current time. This is not a shipment or a backdated movement.", "سجّل المخزون الذي تم تحويله بين الفروع. يتم تحديث الرصيدين معاً بالتوقيت الحالي. هذا ليس طلب شحن أو حركة بتاريخ سابق.")}</p></section>
    <TransferWorkspace actorId={user.id} options={options} locale={locale}/></main>;
}
