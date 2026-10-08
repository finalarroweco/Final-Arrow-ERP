import { translate, type Locale } from "@/lib/locale";

const groups = [
  { en: "Organization", ar: "المؤسسة", links: [
    ["/workspace", "Companies, branches & team", "الشركات والفروع والفريق"],
    ["/approvals", "Approvals", "الموافقات"], ["/audit", "Activity", "سجل النشاط"],
    ["/settings/security", "Account security", "أمان الحساب"],
    ["/settings/roles", "Roles & permissions", "الأدوار والصلاحيات"],
  ] },
  { en: "Customers & sales", ar: "العملاء والمبيعات", links: [
    ["/crm", "Customers", "العملاء"], ["/crm/leads", "Leads", "العملاء المحتملون"],
    ["/sales/quotes", "Quotes", "عروض الأسعار"], ["/sales/orders", "Sales orders", "طلبات البيع"],
  ] },
  { en: "Purchasing & inventory", ar: "المشتريات والمخزون", links: [
    ["/purchasing/suppliers", "Suppliers", "الموردون"], ["/purchasing/orders", "Purchase orders", "طلبات الشراء"],
    ["/purchasing/receipts", "Goods receipts", "استلام البضائع"],
    ["/purchasing/returns", "Goods returns", "مرتجعات البضائع"],
    ["/accounting/collections", "Customer collections", "تحصيلات العملاء"],
    ["/accounting/customer-statement", "Customer statements", "كشوف العملاء"],
    ["/purchasing/settlements", "Supplier settlements", "تسويات الموردين"],
    ["/purchasing/supplier-statement", "Supplier statements", "كشوف الموردين"],
    ["/purchasing/supplier-balances", "Supplier balances", "أرصدة الموردين"], ["/inventory/items", "Items", "الأصناف"], ["/inventory/stock", "Stock & movements", "المخزون والحركات"],
  ] },
  { en: "People & operations", ar: "الموظفون والعمليات", links: [
    ["/hr/employees", "Employees", "الموظفون"], ["/hr/attendance", "Attendance", "الحضور"],
    ["/hr/leave", "Leave", "الإجازات"], ["/hr/payroll", "Payroll", "الرواتب"],
    ["/projects", "Projects", "المشاريع"], ["/helpdesk", "Helpdesk", "الدعم الفني"],
  ] },
  { en: "Accounting & POS", ar: "المحاسبة ونقاط البيع", links: [
    ["/accounting/invoices", "Invoices", "الفواتير"], ["/accounting/expenses", "Expenses", "المصاريف"],
    ["/accounting/ledger", "Ledger & financial reports", "دفتر الأستاذ والتقارير المالية"],
    ["/pos", "Point of sale", "نقاط البيع"], ["/pos/kitchen", "Kitchen queue", "طلبات المطبخ"],
  ] },
];

export function ModuleLauncher({ locale }: { locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <nav className="module-launcher" aria-label={t("Application modules", "وحدات النظام")}>
    <h2>{t("Open a workspace", "افتح مساحة عمل")}</h2>
    <p>{t("Each workspace shows records within your permissions. POS requires a branch.",
      "تعرض كل مساحة السجلات ضمن صلاحياتك. تحتاج نقاط البيع إلى فرع.")}</p>
    <div className="module-groups">{groups.map(group => <div key={group.en}>
      <h3>{t(group.en, group.ar)}</h3>
      <ul>{group.links.map(([href, en, ar]) => <li key={href}><a href={href}>{t(en, ar)}</a></li>)}</ul>
    </div>)}</div>
  </nav>;
}

