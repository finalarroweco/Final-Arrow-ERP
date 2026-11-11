import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadReorderAccess } from "@/lib/stock-reorder-access";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { ReorderWorkspace } from "./workspace";
import type { ReorderScopeOption } from "./types";
export default async function ReorderPage() {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { tenantId: true } });
  const options: ReorderScopeOption[] = [];
  for (const membership of memberships) {
    options.push(...await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${membership.tenantId}::uuid FOR SHARE`;
      const access = await loadReorderAccess(tx, actor.id, membership.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: membership.tenantId }, select: { name: true, companies: { select: { id: true, name: true, branches: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } }, orderBy: [{ name: "asc" }, { id: "asc" }] } } });
      const result: ReorderScopeOption[] = [];
      for (const company of tenant?.companies ?? []) for (const branch of company.branches) {
        const scope = { companyId: company.id, branchId: branch.id };
        if (access.canRead(scope)) result.push({ tenantId: membership.tenantId, ...scope, label: `${tenant?.name} / ${company.name} / ${branch.name}`, canManage: access.canManage(scope) });
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 }));
  }
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/inventory/stock">{t("Stock", "المخزون")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header><section className="hero"><h1>{t("Manual reorder policies", "سياسات إعادة الطلب اليدوية")}</h1><p className="sub">{t("Explicit thresholds and a current low-stock report. No purchasing or stock changes.", "حدود يحددها المستخدم وتقرير حالي لنقص المخزون. دون شراء أو تغيير للمخزون.")}</p></section><ReorderWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
