import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { HelpdeskWorkspace } from "./workspace";

export default async function HelpdeskPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "ticket:read" });
    if (visible === false) return null;
    const rights = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "ticket:create" }),
      canManage: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "ticket:manage" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      companyRights: await rights(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await rights(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/crm">Customers</a><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>HELPDESK</p><h1>Support tickets.</h1><p className="sub">Keep customer issues and internal requests moving.</p></section>
    <HelpdeskWorkspace options={options} />
  </main>;
}
