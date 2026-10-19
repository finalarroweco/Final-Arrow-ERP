import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readableCompanyPermissions } from "@/lib/access";
import { db } from "@/lib/db";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";
import { ImportWorkspace, type ImportOption } from "./workspace";
export default async function ImportPage() {
 const user = await currentUser(); if (!user) redirect("/login");
 const locale = await getLocale(), t = (en: string, ar: string) => translate(locale, en, ar);
 const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" }, include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
 const options: ImportOption[] = [];
 const sourceKinds = [["CUSTOMER", "customer"], ["SUPPLIER", "supplier"], ["ITEM", "inventory-item"]] as const;
 const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map(company => ({ tenant, company })));
 const groups = await Promise.all(candidates.map(async ({ tenant, company }) => {
  const rights = await readableCompanyPermissions({ userId: user.id, tenantId: tenant.id, companyId: company.id, permissions: sourceKinds.flatMap(([, source]) => [source + ":read", source + ":create"]) });
  return [null, ...company.branches].flatMap(branch => {
   const allows = (permission: string) => rights[permission] === null || (!!branch && Array.isArray(rights[permission]) && (rights[permission] as string[]).includes(branch.id));
   const kinds = sourceKinds.filter(([, source]) => allows(source + ":read") && allows(source + ":create")).map(([kind]) => kind);
   return kinds.length ? [{ tenantId: tenant.id, companyId: company.id, branchId: branch?.id ?? null, label: `${tenant.name} / ${company.name} / ${branch?.name ?? t("Company-wide", "على مستوى الشركة")}`, kinds }] : [];
  });
 }));
 options.push(...groups.flat());
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /><a href="/dashboard">{t("Dashboard", "لوحة التحكم")}</a><a href="/crm">{t("Customers", "العملاء")}</a><a href="/purchasing/suppliers">{t("Suppliers", "الموردون")}</a><a href="/inventory/items">{t("Items", "الأصناف")}</a></header>
 <section className="hero"><p>{t("DATA IMPORT", "استيراد البيانات")}</p><h1>{t("Preview. Check. Import.", "عاين، راجع، ثم استورد.")}</h1><p className="sub">{t("Create up to 500 customers, suppliers or catalog items per CSV. All records save together. Existing codes are rejected; balances and stock quantities are entered in their operational workflows.", "أنشئ حتى 500 عميل أو مورد أو صنف في ملف CSV. تُحفظ الدفعة كاملة، وتُرفض الأكواد الموجودة. تُدخل الأرصدة وكميات المخزون عبر عملياتها المخصصة.")}</p></section>
 <ImportWorkspace options={options} locale={locale} actorId={user.id} /></main>;
}
