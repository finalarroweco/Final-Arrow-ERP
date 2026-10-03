import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";

const uuid = z.string().uuid();
const createSchema = z.object({
  tenantId: uuid,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().regex(/^[A-Z0-9-]{2,20}$/),
  legalName: z.string().trim().max(200).optional(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).default("OMR"),
});

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const tenantId = uuid.safeParse(new URL(request.url).searchParams.get("tenantId"));
  if (!tenantId.success) return NextResponse.json({ error: "Invalid tenant" }, { status: 400 });
  const membership = await db.membership.findUnique({
    where: { tenantId_userId: { tenantId: tenantId.data, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const candidates = await db.company.findMany({
    where: { tenantId: tenantId.data },
    select: { id: true, name: true, code: true, legalName: true, baseCurrency: true, branches: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
  const companies = (await Promise.all(candidates.map(async (company) => {
    const allowed = await canAccess({
      userId: user.id, tenantId: tenantId.data, companyId: company.id, permission: "company:read",
    }) || (await Promise.all(company.branches.map((branch) => canAccess({
      userId: user.id, tenantId: tenantId.data, companyId: company.id, branchId: branch.id, permission: "company:read",
    })))).some(Boolean);
    return allowed ? {
      id: company.id, name: company.name, code: company.code,
      legalName: company.legalName, baseCurrency: company.baseCurrency,
    } : null;
  }))).filter((company) => company !== null);
  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid company" }, { status: 400 });
  const { tenantId, ...data } = parsed.data;
  if (!(await canAccess({ userId: user.id, tenantId, permission: "company:create" })))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const company = await db.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { tenantId, ...data } });
      await tx.auditLog.create({
        data: { tenantId, actorId: user.id, action: "company.created", entity: "Company", entityId: company.id },
      });
      return company;
    });
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002")
      return NextResponse.json({ error: "Company code already in use" }, { status: 409 });
    throw error;
  }
}
