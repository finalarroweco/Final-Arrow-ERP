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
  const supplier = await db.supplier.create({ data: { tenantId: a.id, companyId: companyA.id,
    code: "SUP-A", displayName: "Supplier A", createdBy: randomUUID() } });
  await assert.rejects(db.purchaseOrder.create({ data: { tenantId: b.id, companyId: companyB.id,
    supplierId: supplier.id, number: "BAD-PO", supplierName: "Supplier A", currency: "OMR",
    subtotal: "1.000", createdBy: randomUUID() } }));
  await assert.rejects(db.inventoryItem.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, sku: "BAD-ITEM", name: "Wrong branch item", unit: "EA", createdBy: randomUUID() } }));
  const stockItem = await db.inventoryItem.create({ data: { tenantId: a.id, companyId: companyA.id,
    sku: "STOCK-A", name: "Stock Item", unit: "EA", createdBy: randomUUID() } });
  await assert.rejects(db.stockBalance.create({ data: { tenantId: b.id, companyId: companyB.id,
    branchId: branchB.id, itemId: stockItem.id } }));
  const stockBalance = await db.stockBalance.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, itemId: stockItem.id } });
  await assert.rejects(db.stockBalance.update({ where: { id: stockBalance.id }, data: { quantity: "-1.000" } }));
  await assert.rejects(db.stockMovement.create({ data: { tenantId: a.id, balanceId: stockBalance.id,
    type: "ADJUSTMENT_OUT", delta: "1.000", reason: "Invalid direction", actorId: randomUUID() } }));
  const order = await db.purchaseOrder.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, supplierId: supplier.id, number: "PO-DB", supplierName: "Supplier A",
    currency: "OMR", subtotal: "1.000", createdBy: randomUUID() } });
  await assert.rejects(db.goodsReceipt.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, orderId: order.id, createdBy: randomUUID() } }));
  await assert.rejects(db.quote.create({
    data: { tenantId: b.id, companyId: companyB.id, customerId: customer.id,
      number: "BAD-Q", currency: "OMR", subtotal: "1.000", createdBy: randomUUID() },
  }));
  const quote = await db.quote.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, customerId: customer.id, number: "Q-DB", currency: "OMR",
    subtotal: "1.000", createdBy: randomUUID() } });
  const salesOrder = await db.salesOrder.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, customerId: customer.id, quoteId: quote.id, number: "SO-DB",
    customerName: "Customer A", currency: "OMR", subtotal: "1.000", createdBy: randomUUID() } });
  await assert.rejects(db.invoice.create({ data: { tenantId: b.id, companyId: companyB.id,
    customerId: customer.id, orderId: salesOrder.id, number: "BAD-INV", customerName: "Customer A",
    currency: "OMR", subtotal: "1.000", createdBy: randomUUID() } }));

  const project = await db.project.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, code: "PRJ-DB", name: "Database project", createdBy: randomUUID() } });
  await assert.rejects(db.project.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, code: "PRJ-BAD", name: "Wrong branch", createdBy: randomUUID() } }));
  await assert.rejects(db.projectTask.create({ data: { tenantId: b.id, companyId: companyB.id,
    projectId: project.id, title: "Wrong company", createdBy: randomUUID() } }));
  const task = await db.projectTask.create({ data: { tenantId: a.id, companyId: companyA.id,
    projectId: project.id, title: "Valid task", createdBy: randomUUID() } });
  assert.equal(task.projectId, project.id);

  const employee = await db.employee.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, code: "EMP-DB", fullName: "Valid employee", createdBy: randomUUID() } });
  assert.equal(employee.branchId, branchA.id);
  await assert.rejects(db.projectTask.create({ data: { tenantId: b.id, companyId: companyB.id,
    projectId: project.id, assigneeEmployeeId: employee.id, title: "Wrong assignment",
    createdBy: randomUUID() } }));
  const assignedTask = await db.projectTask.create({ data: { tenantId: a.id, companyId: companyA.id,
    projectId: project.id, assigneeEmployeeId: employee.id, title: "Assigned task",
    createdBy: randomUUID() } });
  assert.equal(assignedTask.assigneeEmployeeId, employee.id);
  await assert.rejects(db.ticket.create({ data: { tenantId: b.id, companyId: companyB.id,
    customerId: customer.id, number: "TKT-CROSS", subject: "Bad ticket",
    description: "Wrong company", createdBy: randomUUID() } }));
  await assert.rejects(db.ticket.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, number: "TKT-BRANCH", subject: "Bad ticket",
    description: "Wrong branch", createdBy: randomUUID() } }));
  const ticket = await db.ticket.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, customerId: customer.id, assigneeEmployeeId: employee.id,
    number: "TKT-DB", subject: "Valid ticket", description: "Linked records", createdBy: randomUUID() } });
  assert.equal(ticket.status, "OPEN");
  await assert.rejects(db.employee.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, code: "EMP-BAD", fullName: "Wrong branch", createdBy: randomUUID() } }));

  await assert.rejects(db.expense.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchB.id, number: "EXP-BAD", description: "Wrong branch", category: "Other",
    amount: "1.000", currency: "OMR", expenseDate: new Date("2026-09-30"), createdBy: randomUUID() } }));
  await assert.rejects(db.expense.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, number: "EXP-ZERO", description: "Zero amount", category: "Other",
    amount: "0.000", currency: "OMR", expenseDate: new Date("2026-09-30"), createdBy: randomUUID() } }));
  const expense = await db.expense.create({ data: { tenantId: a.id, companyId: companyA.id,
    branchId: branchA.id, number: "EXP-DB", description: "Valid expense", category: "Other",
    amount: "2.500", currency: "OMR", expenseDate: new Date("2026-09-30"), createdBy: randomUUID() } });
  assert.equal(expense.branchId, branchA.id);

  await assert.rejects(db.leaveRequest.create({ data: { tenantId: b.id, companyId: companyB.id,
    employeeId: employee.id, type: "ANNUAL", startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-02"), createdBy: randomUUID() } }));
  await assert.rejects(db.leaveRequest.create({ data: { tenantId: a.id, companyId: companyA.id,
    employeeId: employee.id, branchId: branchB.id, type: "ANNUAL", startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-02"), createdBy: randomUUID() } }));
  await assert.rejects(db.leaveRequest.create({ data: { tenantId: a.id, companyId: companyA.id,
    employeeId: employee.id, branchId: branchA.id, type: "ANNUAL", startDate: new Date("2026-10-03"),
    endDate: new Date("2026-10-02"), createdBy: randomUUID() } }));
  const leave = await db.leaveRequest.create({ data: { tenantId: a.id, companyId: companyA.id,
    employeeId: employee.id, branchId: branchA.id, type: "ANNUAL", startDate: new Date("2026-10-01"),
    endDate: new Date("2026-10-02"), createdBy: randomUUID() } });
  assert.equal(leave.status, "PENDING");

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
