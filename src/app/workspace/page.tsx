import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess } from "@/lib/access";
import { createBranch, createCompany, createDepartment, updateCompany } from "./actions";
import { Logout } from "./logout";
import { InviteForm } from "./invite-form";
import { TeamPanel } from "./team-panel";

export default async function Workspace() {
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
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><div className="account"><a href="/crm">CRM</a><a href="/sales/quotes">Quotes</a><a href="/sales/orders">Orders</a> {user.name} <Logout /></div></header>
    <section className="hero"><p>WORKSPACE</p><h1>Your companies.</h1><p className="sub">Manage the company and branch hierarchy within your organization.</p></section>
    {visible.map(({ tenant, companies, canCreate, canInvite, canManage }) => <section key={tenant.id}>
      <h2>{tenant.name}</h2>
      {canCreate && <form action={createCompany} className="formrow">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <input name="name" placeholder="Company name" required minLength={2} maxLength={120} />
        <input name="code" placeholder="Code, e.g. FA01" required minLength={2} maxLength={20} />
        <label>Currency <input name="baseCurrency" defaultValue="OMR" required pattern="[A-Z]{3}" maxLength={3} list="currencies" /></label>
        <button type="submit">Add company</button>
      </form>}
      <datalist id="currencies"><option value="OMR" /><option value="JOD" /><option value="USD" /><option value="AED" /><option value="SAR" /></datalist>
      <div className="grid">{companies.map((company) => <article key={company.id}>
        <div className="icon">{company.code.slice(0, 2)}</div><h3>{company.name}</h3>
        <p>{company.code} · {company.baseCurrency}</p>
        {company.canUpdate && <details><summary>Company settings</summary><form action={updateCompany} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <label>Name <input name="name" defaultValue={company.name} required minLength={2} maxLength={120} /></label>
          <label>Legal name <input name="legalName" defaultValue={company.legalName ?? ""} maxLength={200} /></label>
          <label>Base currency <input name="baseCurrency" defaultValue={company.baseCurrency} required pattern="[A-Z]{3}" maxLength={3} list="currencies" /></label>
          <button type="submit">Save settings</button>
        </form></details>}
        <ul>{company.branches.map((branch) => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
        {company.departments.length > 0 && <><h4>Departments</h4><ul>{company.departments.map((department) =>
          <li key={department.id}>{department.name}{department.branchId ? " · branch" : " · company"}</li>)}</ul></>}
        {company.canCreateBranch && <form action={createBranch} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder="Branch name" required minLength={2} maxLength={120} />
          <input name="code" placeholder="Branch code" required minLength={2} maxLength={20} />
          <button type="submit">Add branch</button>
        </form>}
        {company.canCreateDepartment && <form action={createDepartment} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder="Department name" required minLength={2} maxLength={120} />
          <select name="branchId" defaultValue="">
            <option value="">Company-wide department</option>
            {company.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
          <button type="submit">Add department</button>
        </form>}
      </article>)}</div>
      {canInvite && <InviteForm tenantId={tenant.id} companies={companies.map((company) => ({
        id: company.id, name: company.name, branches: company.branches.map((branch) => ({ id: branch.id, name: branch.name })),
      }))} />}
      {canManage && <TeamPanel tenantId={tenant.id} currentUserId={user.id} />}
    </section>)}
  </main>;
}
