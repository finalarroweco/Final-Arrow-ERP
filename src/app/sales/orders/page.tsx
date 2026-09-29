import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { OrdersWorkspace } from "./workspace";

export default async function OrdersPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "order:read" });
    if (visible === false) return null;
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      canManageCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        permission: "order:manage" }),
      branches: await Promise.all(company.branches.filter((branch) => visible === null || visible.includes(branch.id))
        .map(async (branch) => ({ id: branch.id, canManage: await canAccess({ userId: user.id,
          tenantId: tenant.id, companyId: company.id, branchId: branch.id, permission: "order:manage" }) }))) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/sales/quotes">Quotes</a><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>SALES</p><h1>Orders.</h1><p className="sub">Accepted quote snapshots ready for operations.</p></section>
    <OrdersWorkspace options={options} />
  </main>;
}
