import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { QuotesWorkspace } from "./workspace";

export default async function QuotesPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const visible = await readableCompanyBranches({ userId: user.id, tenantId: tenant.id,
      companyId: company.id, permission: "quote:read" });
    if (visible === false) return null;
    const permissions = async (branchId?: string) => ({
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "quote:create" }),
      canSend: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "quote:send" }),
      canDecide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId, permission: "quote:decide" }),
    });
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      currency: company.baseCurrency,
      companyPermissions: await permissions(),
      branches: (await Promise.all(company.branches.map(async (branch) => ({ id: branch.id, name: branch.name,
        ...await permissions(branch.id) })))).filter((branch) => visible === null || visible.includes(branch.id)) };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>SALES</p><h1>Quotes.</h1><p className="sub">Customer quotes with branch access and calculated totals.</p></section>
    <QuotesWorkspace options={options} />
  </main>;
}
