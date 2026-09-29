import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { CrmWorkspace, type CompanyOption } from "./workspace";

export default async function CRMPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { include: { branches: true }, orderBy: { name: "asc" } } } } },
  });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }): Promise<CompanyOption | null> => {
    const visible = await readableCompanyBranches({
      userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:read",
    });
    if (visible === false) return null;
    const branches = (await Promise.all(company.branches.map(async (branch) => ({
      id: branch.id, name: branch.name,
      canCreate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:create" }),
      canUpdate: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:update" }),
      canArchive: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id,
        branchId: branch.id, permission: "customer:archive" }),
    })))).filter((branch) => visible === null || visible.includes(branch.id));
    return {
      tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}`,
      branches,
      canCreateCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:create" }),
      canUpdateCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:update" }),
      canArchiveCompanyWide: await canAccess({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission: "customer:archive" }),
    };
  }))).filter((option): option is CompanyOption => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>CRM</p><h1>Customers.</h1><p className="sub">Company and branch customer records with scoped access.</p></section>
    <CrmWorkspace options={options} />
  </main>;
}
