import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess } from "@/lib/access";
import { createBranch, createCompany, createDepartment, updateCompany } from "./actions";
import { Logout } from "./logout";
import { InviteForm } from "./invite-form";
import { TeamPanel } from "./team-panel";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";

export default async function Workspace() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true, departments: true }, orderBy: { name: "asc" } } } } },
  });
  const visible = await Promise.all(memberships.map(async ({ tenant }) => ({
    tenant,
    canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, permission: "company:create" }),
    canInvite: await canAccess({ userId: user.id, tenantId: tenant.id, permission: "user:invite" }),
    canManage: await canAccess({ userId: user.id, tenantId: tenant.id, permission: "user:manage" }),
    companies: (await Promise.all(tenant.companies.map(async (company) => ({
      ...company,
      allowed: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "company:read" }) ||
        (await Promise.all(company.branches.map((branch) => canAccess({
          userId: user.id, tenantId: tenant.id, companyId: company.id, branchId: branch.id,
          permission: "company:read",
        })))).some(Boolean),
      canCreateBranch: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "branch:create" }),
      canUpdate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "company:update" }),
      canCreateDepartment: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "department:create" }),
      branches: (await Promise.all(company.branches.map(async (branch) => ({
        branch,
        allowed: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId: branch.id, permission: "branch:read" }),
      })))).filter(({ allowed }) => allowed).map(({ branch }) => branch),
      departments: (await Promise.all(company.departments.map(async (department) => ({
        department,
        allowed: await canAccess({
          userId: user.id, tenantId: tenant.id, companyId: company.id,
          branchId: department.branchId ?? undefined, permission: "department:read",
        }),
      })))).filter(({ allowed }) => allowed).map(({ department }) => department),
    })))).filter(({ allowed }) => allowed),
  })));
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><div className="account"><LanguageSwitcher locale={locale} /><a href="/hr/employees">{t("Employees", "الموظفون")}</a><a href="/hr/payroll">{t("Payroll", "الرواتب")}</a><a href="/hr/attendance">{t("Attendance", "الحضور")}</a><a href="/hr/leave">{t("Leave", "الإجازات")}</a><a href="/projects">{t("Projects", "المشاريع")}</a><a href="/dashboard">{t("Dashboard", "لوحة المعلومات")}</a><a href="/audit">{t("Activity history", "سجل العمليات")}</a><a href="/approvals">{t("Approvals", "الموافقات")}</a><a href="/crm">CRM</a><a href="/helpdesk">{t("Helpdesk", "الدعم الفني")}</a><a href="/sales/quotes">{t("Quotes", "عروض الأسعار")}</a><a href="/sales/orders">{t("Orders", "الطلبات")}</a><a href="/accounting/invoices">{t("Invoices", "الفواتير")}</a><a href="/accounting/expenses">{t("Expenses", "المصاريف")}</a><a href="/purchasing/suppliers">{t("Suppliers", "الموردون")}</a><a href="/purchasing/orders">{t("Purchase orders", "أوامر الشراء")}</a><a href="/inventory/items">{t("Items", "الأصناف")}</a><a href="/inventory/stock">{t("Stock", "المخزون")}</a> {user.name} <Logout locale={locale} /></div></header>
    <section className="hero"><p>{t("WORKSPACE", "مساحة العمل")}</p><h1>{t("Your companies.", "شركاتك.")}</h1><p className="sub">{t("Manage the company and branch hierarchy within your organization.", "إدارة الشركات والفروع والأقسام في مؤسستك.")}</p></section>
    {visible.map(({ tenant, companies, canCreate, canInvite, canManage }) => <section key={tenant.id}>
      <h2>{tenant.name}</h2>
      {canCreate && <form action={createCompany} className="formrow">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <input name="name" placeholder={t("Company name", "اسم الشركة")} required minLength={2} maxLength={120} />
        <input name="code" placeholder={t("Code, e.g. FA01", "الرمز، مثال FA01")} required minLength={2} maxLength={20} />
        <label>Currency <input name="baseCurrency" defaultValue="OMR" required pattern="[A-Z]{3}" maxLength={3} list="currencies" /></label>
        <button type="submit">{t("Add company", "إضافة شركة")}</button>
      </form>}
      <datalist id="currencies"><option value="OMR" /><option value="JOD" /><option value="USD" /><option value="AED" /><option value="SAR" /></datalist>
      <div className="grid">{companies.map((company) => <article key={company.id}>
        <div className="icon">{company.code.slice(0, 2)}</div><h3>{company.name}</h3>
        <p>{company.code} · {company.baseCurrency}</p>
        {company.canUpdate && <details><summary>{t("Company settings", "إعدادات الشركة")}</summary><form action={updateCompany} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <label>Name <input name="name" defaultValue={company.name} required minLength={2} maxLength={120} /></label>
          <label>Legal name <input name="legalName" defaultValue={company.legalName ?? ""} maxLength={200} /></label>
          <label>Base currency <input name="baseCurrency" defaultValue={company.baseCurrency} required pattern="[A-Z]{3}" maxLength={3} list="currencies" /></label>
          <button type="submit">{t("Save settings", "حفظ الإعدادات")}</button>
        </form></details>}
        <ul>{company.branches.map((branch) => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
        {company.departments.length > 0 && <><h4>{t("Departments", "الأقسام")}</h4><ul>{company.departments.map((department) =>
          <li key={department.id}>{department.name}{department.branchId ? t(" · branch", " · فرع") : t(" · company", " · شركة")}</li>)}</ul></>}
        {company.canCreateBranch && <form action={createBranch} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder={t("Branch name", "اسم الفرع")} required minLength={2} maxLength={120} />
          <input name="code" placeholder={t("Branch code", "رمز الفرع")} required minLength={2} maxLength={20} />
          <button type="submit">{t("Add branch", "إضافة فرع")}</button>
        </form>}
        {company.canCreateDepartment && <form action={createDepartment} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder={t("Department name", "اسم القسم")} required minLength={2} maxLength={120} />
          <select name="branchId" defaultValue="">
            <option value="">{t("Company-wide department", "قسم على مستوى الشركة")}</option>
            {company.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          <button type="submit">{t("Add department", "إضافة قسم")}</button>
        </form>}
      </article>)}</div>
      {canInvite && <InviteForm locale={locale} tenantId={tenant.id} companies={companies.map((company) => ({
        id: company.id, name: company.name, branches: company.branches.map((branch) => ({ id: branch.id, name: branch.name })),
      }))} />}
      {canManage && <TeamPanel locale={locale} tenantId={tenant.id} currentUserId={user.id} />}
    </section>)}
  </main>;
}
