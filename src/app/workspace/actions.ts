"use server";

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccess } from "@/lib/access";

export async function createCompany(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  if (!(await canAccess({ userId: user.id, tenantId, permission: "company:create" })))
    throw new Error("Forbidden");
  const name = String(form.get("name") ?? "").trim();
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (name.length < 2 || name.length > 120 || !/^[A-Z0-9-]{2,20}$/.test(code))
    throw new Error("Invalid company details");
  await db.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { tenantId, name, code } });
    await tx.auditLog.create({
      data: { tenantId, actorId: user.id, action: "company.created", entity: "Company", entityId: company.id },
    });
  });
  redirect("/workspace");
}

export async function createBranch(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  if (!(await canAccess({ userId: user.id, tenantId, companyId, permission: "branch:create" })))
    throw new Error("Forbidden");
  const name = String(form.get("name") ?? "").trim();
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  if (name.length < 2 || name.length > 120 || !/^[A-Z0-9-]{2,20}$/.test(code))
    throw new Error("Invalid branch details");
  await db.$transaction(async (tx) => {
    const branch = await tx.branch.create({ data: { tenantId, companyId, name, code } });
    await tx.auditLog.create({
      data: { tenantId, actorId: user.id, action: "branch.created", entity: "Branch", entityId: branch.id },
    });
  });
  redirect("/workspace");
}
