import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const createSchema = z.object({
  tenantId: uuid,
  companyId: uuid,
  branchId: uuid.optional(),
  name: z.string().trim().min(2).max(120),
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  const branch = params.get("branchId");
  const branchId = branch ? uuid.safeParse(branch) : null;
  if (!tenantId.success || !companyId.success || (branchId && !branchId.success))
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  const scope = {
    userId: user.id, tenantId: tenantId.data, companyId: companyId.data,
    branchId: branchId?.success ? branchId.data : undefined,
    permission: "department:read",
  };
  if (!(await canAccess(scope))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const departments = await db.department.findMany({
    where: { tenantId: scope.tenantId, companyId: scope.companyId,
      ...(branchId?.success ? { branchId: branchId.data } : { branchId: null }) },
    select: { id: true, name: true, branchId: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ departments });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid department" }, { status: 400 });
  const { tenantId, companyId, branchId, name } = parsed.data;
  if (!(await canAccess({ userId: user.id, tenantId, companyId, branchId, permission: "department:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({
    where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  if (branchId) {
    const branch = await db.branch.findUnique({
      where: { tenantId_companyId_id: { tenantId, companyId, id: branchId } }, select: { id: true },
    });
    if (!branch) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
  }
  const department = await db.$transaction(async (tx) => {
    const department = await tx.department.create({ data: { tenantId, companyId, branchId, name } });
    await tx.auditLog.create({
      data: { tenantId, actorId: user.id, action: "department.created", entity: "Department", entityId: department.id },
    });
    return department;
  });
  return NextResponse.json({ department }, { status: 201 });
}
