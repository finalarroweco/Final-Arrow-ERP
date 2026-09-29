import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const schema = z.object({
  tenantId: uuid, companyId: uuid,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/),
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tenantId = uuid.safeParse(params.get("tenantId"));
  const companyId = uuid.safeParse(params.get("companyId"));
  if (!tenantId.success || !companyId.success) return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  if (!(await canAccess({ userId: user.id, tenantId: tenantId.data, companyId: companyId.data, permission: "branch:read" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const branches = await db.branch.findMany({
    where: { tenantId: tenantId.data, companyId: companyId.data },
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ branches });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid branch" }, { status: 400 });
  const { tenantId, companyId, ...data } = parsed.data;
  if (!(await canAccess({ userId: user.id, tenantId, companyId, permission: "branch:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const company = await db.company.findUnique({ where: { tenantId_id: { tenantId, id: companyId } }, select: { id: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  try {
    const branch = await db.$transaction(async (tx) => {
      const branch = await tx.branch.create({ data: { tenantId, companyId, ...data } });
      await tx.auditLog.create({
        data: { tenantId, actorId: user.id, action: "branch.created", entity: "Branch", entityId: branch.id },
      });
      return branch;
    });
    return NextResponse.json({ branch }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Branch code already in use" }, { status: 409 });
    throw error;
  }
}
