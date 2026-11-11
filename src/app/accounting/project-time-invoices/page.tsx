import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { requireTimeInvoiceSession } from "@/lib/project-time-invoicing";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadTimeInvoiceAccess } from "@/lib/project-time-invoice-access";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { TimeInvoiceWorkspace } from "./workspace";
import type { TimeInvoiceScope } from "./types";
export default async function ProjectTimeInvoicesPage() {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { tenantId: true } });
  const options: TimeInvoiceScope[] = [];
  for (const membership of memberships) {
    const scopes = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${membership.tenantId}::uuid FOR SHARE`;
      await requireTimeInvoiceSession(tx,actor.id);
      const access = await loadTimeInvoiceAccess(tx, actor.id, membership.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: membership.tenantId }, select: { name: true, companies: { select: { id: true, name: true, branches: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } }, orderBy: [{ name: "asc" }, { id: "asc" }] } } });
      const result: TimeInvoiceScope[] = [];
      for (const company of tenant?.companies ?? []) {
        for (const branch of [null, ...company.branches]) {
          const scope = { companyId: company.id, branchId: branch?.id ?? null };
          if (!['project:read','project-time:read','project-time-invoice:read'].every(key=>access.can(key,scope))) continue;
          result.push({ tenantId: membership.tenantId, companyId: company.id, branchId: branch?.id ?? null, label: `${tenant?.name} / ${company.name} / ${branch?.name ?? t("Company-wide", "على مستوى الشركة")}`, canGenerate: ['project-time-invoice:generate','invoice:create','invoice:read','project-billing:read','project-billing:manage'].every(key=>access.can(key,scope)) });
        }
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
    options.push(...scopes);
  }
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><h1>{t("Approved-time invoices", "فواتير الوقت المعتمد")}</h1><p className="sub">{t("Select approved time and explicit prices, review the preview, then create a draft invoice.", "اختر الوقت المعتمد والأسعار الصريحة، ثم راجع المعاينة وأنشئ مسودة فاتورة.")}</p></section>
    <TimeInvoiceWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
