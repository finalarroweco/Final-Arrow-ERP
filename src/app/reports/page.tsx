import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";

const groups = [
  { en: "Customers and suppliers", ar: "العملاء والموردون", reports: [
    ["/accounting/customer-balances", "Customer balances", "أرصدة العملاء", "Historical posted source balances", "أرصدة المستندات المرحّلة حتى التاريخ المختار"],
    ["/accounting/customer-aging", "Customer posting-date aging", "أعمار العملاء من تاريخ القيد", "Age from the accounting posting date", "العمر من تاريخ الترحيل المحاسبي"],
    ["/accounting/customer-overdue", "Customer due-date aging", "استحقاقات العملاء", "Contractual due dates; undated documents stay separate", "مواعيد الاستحقاق المتفق عليها؛ المستندات دون موعد منفصلة"],
    ["/accounting/customer-statement", "Customer statements", "كشوف العملاء", "Select a customer and review source movements", "اختر العميل وراجع حركاته المرتبطة بالمستندات"],
    ["/purchasing/supplier-balances", "Supplier balances", "أرصدة الموردين", "Historical posted receipt balances", "أرصدة الاستلام المرحّلة حتى التاريخ المختار"],
    ["/purchasing/supplier-aging", "Supplier posting-date aging", "أعمار الموردين من تاريخ القيد", "Age from the accounting posting date", "العمر من تاريخ الترحيل المحاسبي"],
    ["/purchasing/supplier-overdue", "Supplier due-date aging", "استحقاقات الموردين", "Agreed receipt due dates; undated receipts stay separate", "مواعيد الاستلام المتفق عليها؛ الاستلام دون موعد منفصل"],
    ["/purchasing/supplier-statement", "Supplier statements", "كشوف الموردين", "Select a supplier and review source movements", "اختر المورد وراجع حركاته المرتبطة بالمستندات"],
  ] },
  { en: "Finance and registers", ar: "المالية وسجلات المستندات", reports: [
    ["/accounting/ledger", "Ledger and financial reports", "دفتر الأستاذ والتقارير المالية", "Trial balance, account statements and financial views", "ميزان المراجعة وكشوف الحسابات والعروض المالية"],
    ["/accounting/bank", "Bank reconciliation", "التسوية البنكية", "Imported lines, matching and live reconciliation", "الحركات المستوردة والمطابقة والتسوية الحالية"],
    ["/accounting/invoices", "Invoice register", "سجل الفواتير", "Creation-date filters; invoice value is not cash collected", "فلاتر تاريخ الإنشاء؛ قيمة الفاتورة ليست التحصيل النقدي"],
    ["/accounting/expenses", "Expense register", "سجل المصاريف", "Expense-date totals, categories and saved VAT", "إجماليات تاريخ المصروف والتصنيفات والضريبة المحفوظة"],
    ["/sales/quotes", "Quote register", "سجل عروض الأسعار", "Creation-date, status and customer filters", "فلاتر تاريخ الإنشاء والحالة والعميل"],
    ["/sales/orders", "Sales-order register", "سجل طلبات البيع", "Saved orders, status totals and CSV", "الطلبات المحفوظة وإجماليات الحالات والتصدير"],
    ["/purchasing/orders", "Purchase-order register", "سجل أوامر الشراء", "Order values, supplier and status filters", "قيم الأوامر وفلاتر المورد والحالة"],
    ["/purchasing/receipts", "Goods receipt register", "سجل استلام البضائع", "UTC receipt dates and saved source values", "تواريخ الاستلام بتوقيت UTC وقيم المستندات المحفوظة"],
    ["/purchasing/returns", "Goods return register", "سجل مرتجعات البضائع", "Return documents and source-linked history", "مستندات المرتجعات وتاريخها المرتبط بالمصدر"],
  ] },
  { en: "People and operations", ar: "الموظفون والعمليات", reports: [
    ["/projects/workload", "Cross-project employee workload", "عبء عمل الموظفين عبر المشاريع", "Current open tasks and recorded time by review status", "المهام المفتوحة الحالية والساعات حسب حالة المراجعة"],
    ["/projects", "Project time, budgets and invoices", "ساعات المشاريع والميزانيات والفواتير", "Select a project for its separately authorized reports", "اختر مشروعًا لفتح تقاريره حسب صلاحيات كل تقرير"],
    ["/inventory/stock", "Stock movements and reservations", "حركات المخزون والحجوزات", "Select an item/branch for physical movements and available quantity", "اختر الصنف والفرع للحركات الفعلية والكمية المتاحة"],
    ["/hr/attendance", "Attendance report", "تقرير الحضور", "Work dates and recorded attendance status", "تواريخ العمل وحالات الحضور المسجلة"],
    ["/hr/payroll", "Payroll report", "تقرير الرواتب", "Monthly manual payroll, status and currency totals", "الرواتب اليدوية الشهرية وإجماليات الحالة والعملة"],
    ["/helpdesk/deadlines", "Ticket deadlines", "مواعيد التذاكر", "Current manual deadlines and overdue tickets", "المواعيد اليدوية الحالية والتذاكر المتأخرة"],
    ["/pos", "POS sales, refunds and shifts", "مبيعات نقاط البيع والاسترداد والورديات", "Choose a branch and open its dated operational reports", "اختر الفرع وافتح تقاريره التشغيلية حسب التاريخ"],
    ["/audit", "Activity history", "سجل العمليات", "Scoped audit dates, actions and actors", "تواريخ العمليات وإجراءاتها ومنفذوها ضمن الصلاحيات"],
  ] },
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!await currentUser()) redirect("/login");
  const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
  const query = await searchParams, q = typeof query.q === "string" ? query.q.trim().slice(0, 120) : "";
  const needle = q.toLocaleLowerCase();
  const visible = groups.map(group => ({ ...group, reports: group.reports.filter(report =>
    [...report.slice(1), group.en, group.ar].join(" ").toLocaleLowerCase().includes(needle)) })).filter(group => group.reports.length);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/saved-reports">{t("My saved reports", "تقاريري المحفوظة")}</a></header>
    <section className="hero"><p>{t("REPORT CENTER", "مركز التقارير")}</p><h1>{t("Find the report you need.", "اعثر على التقرير الذي تحتاجه.")}</h1><p className="sub">{t("One directory for financial and operational reports.", "دليل واحد للتقارير المالية والتشغيلية.")}</p></section>
    <section className="panel"><form method="get"><label>{t("Search reports", "بحث التقارير")}<input name="q" maxLength={120} defaultValue={q} /></label><button>{t("Search", "بحث")}</button><a href="/reports">{t("Show all", "عرض الكل")}</a></form>
      <p>{t("This directory contains no business records or combined totals. Each destination checks your current permissions and offers its own company, branch, date, print and export controls. Some reports open inside their workspace after selecting a source.", "لا يحتوي هذا الدليل على سجلات العمل أو إجماليات مجمّعة. تتحقق كل وجهة من صلاحياتك الحالية وتعرض خياراتها للشركة والفرع والتاريخ والطباعة والتصدير. تُفتح بعض التقارير داخل مساحة العمل بعد اختيار المصدر.")}</p>
      <p><a href="/saved-reports">{t("Reuse private balance and aging filters", "إعادة استخدام فلاتر الأرصدة والأعمار الخاصة")}</a> · <a href="/release-status">{t("Supported scope and remaining work", "النطاق المدعوم والعمل المتبقي")}</a></p>
      {!visible.length && <p role="status">{t("No report matches this search.", "لا يوجد تقرير يطابق هذا البحث.")}</p>}
    </section>
    {visible.map(group => <section className="panel" key={group.en}><h2>{t(group.en, group.ar)}</h2><div className="grid">{group.reports.map(([href, en, ar, detailEn, detailAr]) => <article className="card" key={href}><h3><a href={href}>{t(en, ar)}</a></h3><p>{t(detailEn, detailAr)}</p></article>)}</div></section>)}
  </main>;
}
