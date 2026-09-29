import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  password: z.string().min(12).max(128),
  organization: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]{3,40}$/),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_REGISTRATION !== "true")
    return NextResponse.json({ error: "Registration is closed" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid registration details" }, { status: 400 });
  const { name, email, password, organization, slug } = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash: await hashPassword(password) } });
      const tenant = await tx.tenant.create({ data: { name: organization, slug } });
      const membership = await tx.membership.create({
        data: { tenantId: tenant.id, userId: user.id, status: "ACTIVE" },
      });
      const owner = await tx.role.create({ data: { tenantId: tenant.id, name: "Owner" } });
      const manager = await tx.role.create({ data: { tenantId: tenant.id, name: "Manager" } });
      const viewer = await tx.role.create({ data: { tenantId: tenant.id, name: "Viewer" } });
      for (const key of ["company:read", "company:create", "company:update", "branch:read", "branch:create", "department:read", "department:create", "customer:read", "customer:create", "customer:update", "customer:archive", "supplier:read", "supplier:create", "supplier:update", "supplier:archive", "purchase-order:read", "purchase-order:create", "purchase-order:manage", "inventory-item:read", "inventory-item:create", "inventory-item:update", "inventory-item:archive", "lead:read", "lead:create", "lead:update", "lead:convert", "quote:read", "quote:create", "quote:update", "quote:send", "quote:decide", "order:read", "order:create", "order:manage", "user:invite", "user:manage"]) {
        await tx.permission.upsert({ where: { key }, update: {}, create: { key } });
        await tx.rolePermission.create({ data: { tenantId: tenant.id, roleId: owner.id, permissionKey: key } });
        if (key.endsWith(":read") || ["branch:create", "department:create", "customer:create", "customer:update", "customer:archive", "supplier:create", "supplier:update", "supplier:archive", "purchase-order:create", "purchase-order:manage", "inventory-item:create", "inventory-item:update", "inventory-item:archive", "lead:create", "lead:update", "lead:convert", "quote:create", "quote:update", "quote:send", "quote:decide", "order:create", "order:manage"].includes(key))
          await tx.rolePermission.create({ data: { tenantId: tenant.id, roleId: manager.id, permissionKey: key } });
        if (key.endsWith(":read"))
          await tx.rolePermission.create({ data: { tenantId: tenant.id, roleId: viewer.id, permissionKey: key } });
      }
      const grant = await tx.roleGrant.create({
        data: { tenantId: tenant.id, roleId: owner.id, membershipId: membership.id },
      });
      await tx.accessScope.create({ data: { tenantId: tenant.id, grantId: grant.id, type: "TENANT" } });
      await tx.auditLog.create({
        data: { tenantId: tenant.id, actorId: user.id, action: "tenant.created", entity: "Tenant", entityId: tenant.id },
      });
      return { userId: user.id, tenantId: tenant.id };
    });
    await createSession(result.userId);
    return NextResponse.json({ tenantId: result.tenantId }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Email or workspace name already in use" }, { status: 409 });
    throw error;
  }
}
