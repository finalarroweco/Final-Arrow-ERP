import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { ItemsWorkspace } from "./workspace";

export default async function ItemsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "inventory-item:read" });
    if (visible === false) return null;
    const permissions = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "inventory-item:create" }),
      canUpdate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "inventory-item:update" }),
      canArchive: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, branchId, permission: "inventory-item:archive" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      companyPermissions: await permissions(),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, name: branch.name, ...await permissions(branch.id) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/purchasing/orders">Purchase orders</a><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>INVENTORY</p><h1>Item catalog.</h1><p className="sub">Company and branch item records.</p></section>
    <ItemsWorkspace options={options} />
  </main>;
}
