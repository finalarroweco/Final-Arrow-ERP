import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const unique = () => randomUUID().slice(0, 8);

test("database enforces tenant hierarchy and scope shape", async () => {
  const a = await db.tenant.create({ data: { name: "Tenant A", slug: `a-${unique()}` } });
  const b = await db.tenant.create({ data: { name: "Tenant B", slug: `b-${unique()}` } });
  const companyA = await db.company.create({
    data: { tenantId: a.id, name: "Company A", code: "A01" },
  });
  const companyB = await db.company.create({
    data: { tenantId: b.id, name: "Company B", code: "B01" },
  });
  const branchA = await db.branch.create({
    data: { tenantId: a.id, companyId: companyA.id, name: "Muscat", code: "MCT" },
  });
  const branchB = await db.branch.create({
    data: { tenantId: b.id, companyId: companyB.id, name: "Sohar", code: "SHR" },
  });
  assert.equal(branchA.companyId, companyA.id);

  await assert.rejects(db.branch.create({
    data: { tenantId: b.id, companyId: companyA.id, name: "Wrong tenant", code: "BAD" },
  }));
  await assert.rejects(db.department.create({
    data: { tenantId: a.id, companyId: companyA.id, branchId: branchB.id, name: "Wrong branch" },
  }));
  const customer = await db.customer.create({
    data: { tenantId: a.id, companyId: companyA.id, branchId: branchA.id,
      code: "CUST-A", displayName: "Customer A", createdBy: randomUUID() },
  });
  assert.equal(customer.branchId, branchA.id);
  await assert.rejects(db.customer.create({
    data: { tenantId: a.id, companyId: companyA.id, branchId: branchB.id,
      code: "CUST-B", displayName: "Wrong branch customer", createdBy: randomUUID() },
  }));
  await assert.rejects(db.supplier.create({
    data: { tenantId: a.id, companyId: companyA.id, branchId: branchB.id,
      code: "SUP-B", displayName: "Wrong branch supplier", createdBy: randomUUID() },
  }));
  await assert.rejects(db.quote.create({
    data: { tenantId: b.id, companyId: companyB.id, customerId: customer.id,
      number: "BAD-Q", currency: "OMR", subtotal: "1.000", createdBy: randomUUID() },
  }));

  const user = await db.user.create({
    data: { email: `test-${unique()}@example.invalid`, name: "Test", passwordHash: "test-only" },
  });
  const membership = await db.membership.create({
    data: { tenantId: a.id, userId: user.id, status: "ACTIVE" },
  });
  const role = await db.role.create({ data: { tenantId: a.id, name: "Test Role" } });
  const grant = await db.roleGrant.create({
    data: { tenantId: a.id, membershipId: membership.id, roleId: role.id },
  });
  await db.accessScope.create({
    data: { tenantId: a.id, grantId: grant.id, type: "BRANCH", companyId: companyA.id, branchId: branchA.id },
  });
  await assert.rejects(db.accessScope.create({
    data: { tenantId: a.id, grantId: grant.id, type: "BRANCH", companyId: companyA.id },
  }));
  await assert.rejects(db.accessScope.create({
    data: { tenantId: a.id, grantId: grant.id, type: "COMPANY", companyId: companyB.id },
  }));
  await assert.rejects(db.roleGrant.create({
    data: { tenantId: b.id, membershipId: membership.id, roleId: role.id },
  }));
  const invitation = await db.invitation.create({
    data: { tenantId: a.id, email: "invited@example.invalid", tokenHash: randomUUID(),
      roleId: role.id, type: "BRANCH", companyId: companyA.id, branchId: branchA.id,
      createdBy: user.id, expiresAt: new Date(Date.now() + 86400_000) },
  });
  assert.equal(invitation.branchId, branchA.id);
  await assert.rejects(db.invitation.create({
    data: { tenantId: a.id, email: "bad@example.invalid", tokenHash: randomUUID(),
      roleId: role.id, type: "BRANCH", companyId: companyA.id,
      createdBy: user.id, expiresAt: new Date(Date.now() + 86400_000) },
  }));
  await assert.rejects(db.invitation.create({
    data: { tenantId: a.id, email: "bad@example.invalid", tokenHash: randomUUID(),
      roleId: role.id, type: "COMPANY", companyId: companyB.id,
      createdBy: user.id, expiresAt: new Date(Date.now() + 86400_000) },
  }));
});

test.after(async () => db.$disconnect());
