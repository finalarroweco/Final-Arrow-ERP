import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../../language-switcher";
import { TermTemplatesWorkspace } from "./workspace";
export default async function PaymentTermsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await currentUser(); if (!actor) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const memberships = await db.membership.findMany({ where: { userId: actor.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { orderBy: { name: "asc" } } } } } });
  const options = (await Promise.all(memberships.flatMap(({ tenant }) => tenant.companies.map(async company => {
    const scope = { userId: actor.id, tenantId: tenant.id, companyId: company.id };
    if (await readableCompanyBranches({ ...scope, permission: "payment-term:read" }) === false) return null;
    return { value: tenant.id + ":" + company.id, tenantId: tenant.id, companyId: company.id, label: tenant.name + " / " + company.name,
      canManage: await canAccess({ ...scope, permission: "payment-term:manage" }) };
  })))).filter(option => option !== null);
  const query = await searchParams, selected = options.find(option => option.value === query.scope) ?? (query.scope ? undefined : options[0]);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/accounting/invoices">{t("Invoices", "الفواتير")}</a><a href="/purchasing/orders">{t("Purchasing", "المشتريات")}</a></header>
    <section className="hero"><p>{t("PAYMENT TERMS", "شروط الدفع")}</p><h1>{t("Reusable company payment terms.", "شروط دفع محفوظة للشركة.")}</h1><p className="sub">{t("Keep agreed descriptions and calendar-day periods ready for new documents.", "احفظ أوصاف الاتفاقات ومدد الأيام التقويمية لاستخدامها في المستندات الجديدة.")}</p></section>
    <section className="panel"><p>{t("Templates are shared across company branches. Reading follows your granted scope; management requires company-wide permission. The name, description and days are permanent. Archive with a reason and create a replacement to change a definition. Archived history remains; existing invoice/receipt terms never change.", "القوالب مشتركة بين فروع الشركة. تتبع القراءة صلاحياتك، وتتطلب الإدارة صلاحية على مستوى الشركة. الاسم والوصف وعدد الأيام ثابتة. لتغيير التعريف، أرشف القالب بسبب واضح وأنشئ بديلًا. يبقى التاريخ المؤرشف، ولا تتغير شروط الفواتير والاستلام المحفوظة.")}</p>
      {options.length ? <form method="get"><label>{t("Company", "الشركة")}<select name="scope" defaultValue={selected?.value ?? ""}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button>{t("Select company", "اختيار الشركة")}</button></form> : <p>{t("No accessible payment-term catalog.", "لا يوجد دليل شروط دفع متاح بالصلاحيات الحالية.")}</p>}
    </section>
    {selected ? <TermTemplatesWorkspace key={actor.id + selected.value} actorId={actor.id} scope={selected} locale={locale} /> : options.length ? <p role="alert">{t("Select an accessible company.", "اختر شركة متاحة.")}</p> : null}
  </main>;
}
