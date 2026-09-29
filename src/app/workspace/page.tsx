import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess } from "@/lib/access";
import { createBranch, createCompany } from "./actions";

export default async function Workspace() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } },
  });
  const visible = await Promise.all(memberships.map(async ({ tenant }) => ({
    tenant,
    canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, permission: "company:create" }),
    companies: (await Promise.all(tenant.companies.map(async (company) => ({
      ...company,
      allowed: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "company:read" }),
      canCreateBranch: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "branch:create" }),
      branches: (await Promise.all(company.branches.map(async (branch) => ({
        branch,
        allowed: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId: branch.id, permission: "branch:read" }),
      })))).filter(({ allowed }) => allowed).map(({ branch }) => branch),
    })))).filter(({ allowed }) => allowed),
  })));
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><div>{user.name}</div></header>
    <section className="hero"><p>WORKSPACE</p><h1>Your companies.</h1><p className="sub">Manage the company and branch hierarchy within your organization.</p></section>
    {visible.map(({ tenant, companies, canCreate }) => <section key={tenant.id}>
      <h2>{tenant.name}</h2>
      {canCreate && <form action={createCompany} className="formrow">
        <input type="hidden" name="tenantId" value={tenant.id} />
        <input name="name" placeholder="Company name" required minLength={2} maxLength={120} />
        <input name="code" placeholder="Code, e.g. FA01" required minLength={2} maxLength={20} />
        <button type="submit">Add company</button>
      </form>}
      <div className="grid">{companies.map((company) => <article key={company.id}>
        <div className="icon">{company.code.slice(0, 2)}</div><h3>{company.name}</h3>
        <p>{company.code} · {company.baseCurrency}</p>
        <ul>{company.branches.map((branch) => <li key={branch.id}>{branch.name} ({branch.code})</li>)}</ul>
        {company.canCreateBranch && <form action={createBranch} className="branchform">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="companyId" value={company.id} />
          <input name="name" placeholder="Branch name" required minLength={2} maxLength={120} />
          <input name="code" placeholder="Branch code" required minLength={2} maxLength={20} />
          <button type="submit">Add branch</button>
        </form>}
      </article>)}</div>
    </section>)}
  </main>;
}
