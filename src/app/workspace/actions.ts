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
  const baseCurrency = String(form.get("baseCurrency") ?? "OMR").trim().toUpperCase();
  if (name.length < 2 || name.length > 120 || !/^[A-Z0-9-]{2,20}$/.test(code) || !/^[A-Z]{3}$/.test(baseCurrency))
    throw new Error("Invalid company details");
  await db.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { tenantId, name, code, baseCurrency } });
    await tx.auditLog.create({
      data: { tenantId, actorId: user.id, action: "company.created", entity: "Company", entityId: company.id },
    });
  });
  redirect("/workspace");
}

export async function updateCompany(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  if (!(await canAccess({ userId: user.id, tenantId, companyId, permission: "company:update" })))
    throw new Error("Forbidden");
  const name = String(form.get("name") ?? "").trim();
  const legalName = String(form.get("legalName") ?? "").trim() || null;
  const baseCurrency = String(form.get("baseCurrency") ?? "").trim().toUpperCase();
  if (name.length < 2 || name.length > 120 || (legalName && legalName.length > 200) || !/^[A-Z]{3}$/.test(baseCurrency))
    throw new Error("Invalid company settings");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
    if(baseCurrency!=="OMR" && (await tx.companyVatProfile.findUnique({where:{companyId}}))?.enabled) throw new Error("Disable Oman VAT before changing currency");
    const previous = await tx.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } },
      select: { baseCurrency: true } });
    if (!previous) throw new Error("Company not found");
    await tx.company.update({ where: { tenantId_id: { tenantId, id: companyId } },
      data: { name, legalName, baseCurrency } });
    await tx.auditLog.create({ data: { tenantId, actorId: user.id, action: "company.updated",
      entity: "Company", entityId: companyId,
      metadata: { previousCurrency: previous.baseCurrency, baseCurrency } } });
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

export async function createDepartment(form: FormData) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenantId = String(form.get("tenantId") ?? "");
  const companyId = String(form.get("companyId") ?? "");
  const branchId = String(form.get("branchId") ?? "") || undefined;
  if (!(await canAccess({ userId: user.id, tenantId, companyId, branchId, permission: "department:create" })))
    throw new Error("Forbidden");
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) throw new Error("Invalid department name");
  const company = await db.company.findUnique({
    where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true },
  });
  if (!company) throw new Error("Company not found");
  if (branchId) {
    const branch = await db.branch.findUnique({
      where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true },
    });
    if (!branch) throw new Error("Branch not found");
  }
  await db.$transaction(async (tx) => {
    const department = await tx.department.create({ data: { tenantId, companyId, branchId, name } });
    await tx.auditLog.create({
      data: { tenantId, actorId: user.id, action: "department.created", entity: "Department", entityId: department.id },
    });
  });
  redirect("/workspace");
}
