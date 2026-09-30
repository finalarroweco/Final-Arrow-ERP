import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { DashboardWorkspace } from "./workspace";

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const memberships = await db.membership.findMany({ where: { userId: user.id, status: "ACTIVE" },
    include: { tenant: { include: { companies: { orderBy: { name: "asc" } } } } } });
  const candidates = memberships.flatMap(({ tenant }) => tenant.companies.map((company) => ({ tenant, company })));
  const options = (await Promise.all(candidates.map(async ({ tenant, company }) => {
    const access = await Promise.all(["customer:read", "lead:read", "quote:read", "order:read",
      "project:read", "employee:read", "expense:read"].map((permission) =>
      readableCompanyBranches({ userId: user.id, tenantId: tenant.id, companyId: company.id, permission })));
    if (access.every((value) => value === false)) return null;
    return { tenantId: tenant.id, companyId: company.id, label: `${tenant.name} / ${company.name}` };
  }))).filter((option) => option !== null);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><a href="/workspace">Workspace</a></header>
    <section className="hero"><p>OVERVIEW</p><h1>Dashboard.</h1><p className="sub">Live company activity within your access scope.</p></section>
    <DashboardWorkspace options={options} />
  </main>;
}
