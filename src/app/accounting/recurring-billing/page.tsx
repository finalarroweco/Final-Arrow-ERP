import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadBillingAccess } from "@/lib/recurring-access";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { BillingWorkspace } from "./workspace";
import type { BillingScopeOption } from "./types";
export default async function SubscriptionsPage() {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { tenantId: true } });
  const options: BillingScopeOption[] = [];
  for (const membership of memberships) {
    const scopes = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${membership.tenantId}::uuid FOR SHARE`;
      const access = await loadBillingAccess(tx, actor.id, membership.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: membership.tenantId }, select: { name: true, companies: { select: { id: true, name: true, branches: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } }, orderBy: [{ name: "asc" }, { id: "asc" }] } } });
      const result: BillingScopeOption[] = [];
      for (const company of tenant?.companies ?? []) {
        for (const branch of [null, ...company.branches]) {
          const scope = { companyId: company.id, branchId: branch?.id ?? null };
          if (!access.can('billing-subscription:read',scope)) continue;
          result.push({ tenantId: membership.tenantId, companyId: company.id, branchId: branch?.id ?? null, label: `${tenant?.name} / ${company.name} / ${branch?.name ?? t("Company-wide", "على مستوى الشركة")}`, canManage: access.can('billing-subscription:manage',scope),canGenerate: access.can('billing-subscription:generate',scope) && access.can('invoice:create',scope) && access.can('invoice:read',scope) });
        }
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
    options.push(...scopes);
  }
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><h1>{t("Recurring billing", "الفوترة الدورية")}</h1><p className="sub">{t("Configure finite billing calendars and generate draft invoices for explicit review.", "إعداد تقويم فوترة محدود وإنشاء مسودات فواتير للمراجعة الصريحة.")}</p></section>
    <BillingWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
