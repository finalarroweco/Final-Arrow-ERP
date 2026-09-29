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
});

test.after(async () => db.$disconnect());
