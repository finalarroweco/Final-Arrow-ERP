import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { operationalParent, OperationalError } from "@/lib/operational-records";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../../language-switcher";
import { DeadlineWorkspace } from "./workspace";
export default async function TicketDeadlinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const actor = await currentUser(); if (!actor) redirect("/login");
 const { id } = await params, query = await searchParams, tenant = z.string().uuid().safeParse(query.tenantId);
 if (!z.string().uuid().safeParse(id).success || !tenant.success) notFound();
 let source;
 try { source = await operationalParent("ticket", id, tenant.data, actor.id); } catch (error) { if (error instanceof OperationalError && [403, 404].includes(error.status)) notFound(); throw error; }
 const canManage = await canAccess({ userId: actor.id, tenantId: tenant.data, companyId: source.companyId, branchId: source.branchId ?? undefined, permission: "ticket:manage" });
 const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/helpdesk">{t("Tickets", "التذاكر")}</a><a href="/helpdesk/deadlines">{t("Deadline register", "سجل المواعيد")}</a><a href={`/helpdesk/messages?${new URLSearchParams({ tenantId: tenant.data, id })}`}>{t("Internal follow-up", "المتابعة الداخلية")}</a></header>
 <section className="hero"><p>{t("TICKET DEADLINE", "موعد التذكرة")}</p><h1>{"subject" in source ? source.subject : ""}</h1><p className="sub">{t("Set or clear a manual resolution deadline and retain every reason and previous change.", "حدّد موعد الحل يدويًا أو ألغِه، مع الاحتفاظ بكل تغيير وسببه.")}</p></section>
 <DeadlineWorkspace key={tenant.data + id} tenantId={tenant.data} ticketId={id} actorId={actor.id} canManage={canManage} locale={locale} /></main>;
}
