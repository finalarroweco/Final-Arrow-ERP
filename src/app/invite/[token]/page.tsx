import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcceptForm } from "./form";

export const metadata = { robots: { index: false, follow: false } };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitation = await db.invitation.findUnique({
    where: { tokenHash }, include: { tenant: { select: { name: true } }, role: { select: { name: true } } },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) notFound();
  const actor = await currentUser();
  const existing = await db.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /></header>
    <section className="hero"><p>{t("TEAM INVITATION", "دعوة للفريق")}</p><h1>{t("Join", "الانضمام إلى")} {invitation.tenant.name}.</h1>
      <p className="sub">{invitation.email} · {t(invitation.role.name, ({ Owner: "مالك", Manager: "مدير", Viewer: "مشاهد" })[invitation.role.name] ?? invitation.role.name)} · {t(invitation.type.toLowerCase(), ({ TENANT: "المؤسسة", COMPANY: "الشركة", BRANCH: "الفرع" })[invitation.type] ?? invitation.type)} {t("access", "صلاحية")}</p>
      {actor && actor.email !== invitation.email
        ? <p>{t("Please sign out and sign in with", "سجّل الخروج ثم ادخل باستخدام")} {invitation.email}.</p>
        : !actor && existing
          ? <p><a href={`/login?next=/invite/${token}`}>{t("Sign in with", "سجّل الدخول باستخدام")} {invitation.email} {t("to accept", "لقبول الدعوة")}</a></p>
          : <AcceptForm token={token} needsAccount={!actor} locale={locale} />}
    </section>
  </main>;
}
