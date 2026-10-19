import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "./language-switcher";

const modules = [
  ["CRM", "العملاء"], ["Sales", "المبيعات"], ["Finance", "المالية"],
  ["Purchasing", "المشتريات"], ["Inventory", "المخزون"], ["HR", "الموارد البشرية"],
  ["Projects", "المشاريع"], ["Approvals", "الموافقات"], ["Subscriptions", "الاشتراكات"],
  ["POS", "نقاط البيع"], ["Helpdesk", "الدعم الفني"], ["Documents", "المستندات"],
  ["Reports", "التقارير"], ["AI", "الذكاء الاصطناعي"],
];
const available = new Set(["CRM", "Sales", "Finance", "Purchasing", "Inventory", "HR", "Projects", "Approvals", "Helpdesk", "POS", "Reports"]);

export default async function Home() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><div className="header-actions"><LanguageSwitcher locale={locale} /><a href="/login">{t("Sign in", "تسجيل الدخول")}</a></div></header>
    <section className="hero"><p>{t("BUSINESS OPERATING SYSTEM", "نظام إدارة الأعمال")}</p><h1>{t("One system.", "نظام واحد.")}<br />{t("Every part of your business.", "لكل أعمالك.")}</h1><p className="sub">{t("A modular workspace for your companies, branches, teams and operations.", "مساحة عمل متكاملة لشركاتك وفروعك وفرقك وعملياتك.")}</p><a className="button" href="/register">{t("Create workspace", "إنشاء مساحة عمل")}</a> <a href="/erp-preview-v6.html">{t("Explore interface preview", "استكشف معاينة الواجهات")}</a></section>
    <section><h2>{t("Applications", "التطبيقات")}</h2><div className="grid">{modules.map(([name, arabic]) => <article key={name}><div className="icon">{name.slice(0, 2).toUpperCase()}</div><h3>{t(name, arabic)}</h3>{available.has(name) ? <a href="/erp-preview-v6.html">{t("Preview interface", "معاينة الواجهة")}</a> : <p>{t("Planned module", "وحدة مخطط لها")}</p>}</article>)}</div></section><footer>Final Arrow AI & Technology</footer></main>;
}
