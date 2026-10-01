import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../../language-switcher";
import { TimeWorkspace } from "./workspace";
import { z } from "zod";

export default async function TimePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); if (!user) redirect("/login");
  const { id } = await params; if (!z.string().uuid().safeParse(id).success) notFound();
  const project = await db.project.findUnique({ where: { id }, select: { id: true, tenantId: true,
    companyId: true, branchId: true, name: true, code: true, status: true } });
  if (!project) notFound();
  const scope = { userId: user.id, tenantId: project.tenantId, companyId: project.companyId, branchId: project.branchId ?? undefined };
  if (!(await canAccess({ ...scope, permission: "project:read" })) || !(await canAccess({ ...scope, permission: "project-time:read" }))) notFound();
  const canManage = await canAccess({ ...scope, permission: "project-time:manage" });
  const locale = await getLocale(); const t = (en: string, ar: string) => translate(locale, en, ar);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/projects">{t("Projects", "المشاريع")}</a><a href="/workspace">{t("Workspace", "مساحة العمل")}</a></header>
    <section className="hero"><p>{t("PROJECT TIME", "وقت المشاريع")}</p><h1>{project.name}</h1><p className="sub">{project.code} · {t("Record staff effort and review project hours.", "سجّل جهد الموظفين وراجع ساعات المشروع.")}</p></section>
    <TimeWorkspace project={project} canManage={canManage} locale={locale} /></main>;
}
