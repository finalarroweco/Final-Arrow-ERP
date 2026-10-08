import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { validateEmployeeAssignment } from "@/lib/employee-assignment";

const uuid = z.string().uuid();
const schema = z.object({ tenantId: uuid, companyId: uuid, branchId: uuid.nullish(),
  customerId: uuid.nullish(), assigneeEmployeeId: uuid.nullish(),
  number: z.string().trim().regex(/^[A-Z0-9-]{2,30}$/),
  subject: z.string().trim().min(2).max(160),
  description: z.string().trim().min(3).max(4000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL") }).strict();

export async function GET(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const query = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(query.get("tenantId"));
  const companyId = uuid.safeParse(query.get("companyId"));
  const page = z.coerce.number().int().min(0).max(100000).safeParse(query.get("page") ?? "0");
  if (!tenantId.success || !companyId.success || !page.success)
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId: tenantId.data,
    companyId: companyId.data, permission: "ticket:read" });
  if (branches === false) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tickets = await db.ticket.findMany({ where: { tenantId: tenantId.data, companyId: companyId.data,
    ...(branches === null ? {} : { branchId: { in: branches } }) },
    select: { id: true, branchId: true, customerId: true, assigneeEmployeeId: true,
      number: true, subject: true, description: true, priority: true, status: true,
      resolutionNote: true, createdAt: true,
      customer: { select: { displayName: true, branchId: true } },
      assignee: { select: { fullName: true, branchId: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: page.data * 50, take: 51 });
  const visible = tickets.slice(0, 50);
  const customerBranches = [...new Set(visible.filter((ticket) => ticket.customer)
    .map((ticket) => ticket.customer?.branchId ?? ""))];
  const employeeBranches = [...new Set(visible.filter((ticket) => ticket.assignee)
    .map((ticket) => ticket.assignee?.branchId ?? ""))];
  const rights = async (ids: string[], permission: string) => new Map(await Promise.all(ids.map(async (branchId) =>
    [branchId, await canAccess({ userId: actor.id, tenantId: tenantId.data, companyId: companyId.data,
      branchId: branchId || undefined, permission })] as const)));
  const [customerRights, employeeRights] = await Promise.all([
    rights(customerBranches, "customer:read"), rights(employeeBranches, "employee:read")]);
  return NextResponse.json({ tickets: visible.map(({ customer, assignee, ...ticket }) => ({
    ...ticket,
    customerName: customer && customerRights.get(customer.branchId ?? "") ? customer.displayName : null,
    assigneeName: assignee && employeeRights.get(assignee.branchId ?? "") ? assignee.fullName : null,
  })), nextPage: tickets.length > 50 ? page.data + 1 : null });
}

export async function POST(request: Request) {
  const actor = await currentUser();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid ticket" }, { status: 400 });
  const { tenantId, companyId, branchId, customerId, assigneeEmployeeId, ...data } = parsed.data;
  if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: branchId ?? undefined,
    permission: "ticket:create" }))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!(await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true } })))
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId && !(await db.branch.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true } })))
    return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { tenantId_companyId_id: { tenantId, companyId, id: customerId } },
      select: { branchId: true, archivedAt: true } });
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (!(await canAccess({ userId: actor.id, tenantId, companyId, branchId: customer.branchId ?? undefined,
      permission: "customer:read" })))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (customer.archivedAt || (customer.branchId && customer.branchId !== branchId))
      return NextResponse.json({ error: "Customer is archived or outside ticket branch" }, { status: 409 });
  }
  if (assigneeEmployeeId) {
    const problem = await validateEmployeeAssignment({ userId: actor.id, tenantId, companyId,
      recordBranchId: branchId ?? null, employeeId: assigneeEmployeeId });
    if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });
  }
  try {
    const ticket = await db.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({ data: { tenantId, companyId, branchId: branchId ?? null,
        customerId: customerId ?? null, assigneeEmployeeId: assigneeEmployeeId ?? null,
        ...data, createdBy: actor.id } });
      await tx.auditLog.create({ data: { tenantId, actorId: actor.id, action: "ticket.created",
        entity: "Ticket", entityId: ticket.id } });
      return ticket;
    });
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Ticket number already in use" }, { status: 409 });
    throw error;
  }
}
