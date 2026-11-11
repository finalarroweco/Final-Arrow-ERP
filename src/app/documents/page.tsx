import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadDocumentAccess } from "@/lib/internal-text-document-access";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { DocumentsWorkspace } from "./workspace";
import type { DocumentScopeOption } from "./types";
export default async function DocumentsPage() {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, select: { tenantId: true } });
  const options: DocumentScopeOption[] = [];
  for (const membership of memberships) {
    const scopes = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${membership.tenantId}::uuid FOR SHARE`;
      const access = await loadDocumentAccess(tx, actor.id, membership.tenantId);
      const tenant = await tx.tenant.findUnique({ where: { id: membership.tenantId }, select: { name: true, companies: { select: { id: true, name: true, branches: { select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] } }, orderBy: [{ name: "asc" }, { id: "asc" }] } } });
      const result: DocumentScopeOption[] = [];
      for (const company of tenant?.companies ?? []) {
        for (const branch of [null, ...company.branches]) {
          const scope = { companyId: company.id, branchId: branch?.id ?? null };
          if (!access.canRead(scope)) continue;
          result.push({ tenantId: membership.tenantId, companyId: company.id, branchId: branch?.id ?? null, label: `${tenant?.name} / ${company.name} / ${branch?.name ?? t("Company-wide", "على مستوى الشركة")}`, canManage: access.canManage(scope) });
        }
      }
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
    options.push(...scopes);
  }
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><h1>{t("Internal text documents", "المستندات النصية الداخلية")}</h1><p className="sub">{t("Operating notes and reference text with explicit revisions and archive history.", "ملاحظات العمل والنصوص المرجعية بإصدارات صريحة وسجل أرشفة.")}</p></section>
    <DocumentsWorkspace actorId={actor.id} options={options} locale={locale}/></main>;
}
