import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess, readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { dueDate } from "@/lib/date";
import { ledgerScope, queryInput } from "@/lib/ledger";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({error:"Unauthenticated"},{status:401});
  const parsed = ledgerScope.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId"]));
  if (!parsed.success) return NextResponse.json({error:"Invalid scope"},{status:400});
  const scope = {userId:actor.id,...parsed.data};
  if (await readableCompanyBranches({...scope,permission:"ledger:read"}) === false) return NextResponse.json({error:"Forbidden"},{status:403});
  const company = await db.company.findUnique({where:{tenantId_id:{tenantId:parsed.data.tenantId,id:parsed.data.companyId}},select:{ledgerLockedThrough:true}});
  if (!company) return NextResponse.json({error:"Company not found"},{status:404});
  return NextResponse.json({lockedThrough:company.ledgerLockedThrough?.toISOString().slice(0,10)??null,
    canManage:await canAccess({...scope,permission:"ledger-period:manage"})},{headers});
}
const schema = ledgerScope.extend({lockedThrough:dueDate.nullable(),expectedLockedThrough:dueDate.nullable(),reason:z.string().trim().min(3).max(500)}).strict();
export async function PATCH(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({error:"Unauthenticated"},{status:401});
  const parsed = schema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({error:"Invalid period lock or reason"},{status:400});
  const {tenantId,companyId,lockedThrough,expectedLockedThrough,reason} = parsed.data;
  if (!(await canAccess({userId:actor.id,tenantId,companyId,permission:"ledger-period:manage"}))) return NextResponse.json({error:"Forbidden"},{status:403});
  const result = await db.$transaction(async tx=>{
    const [company] = await tx.$queryRaw<{ledgerLockedThrough:Date|null}[]>`SELECT "ledgerLockedThrough" FROM "Company" WHERE "tenantId"=${tenantId}::uuid AND "id"=${companyId}::uuid FOR UPDATE`;
    if (!company) return "missing" as const;
    const previous = company.ledgerLockedThrough?.toISOString().slice(0,10)??null;
    if (previous !== expectedLockedThrough) return "stale" as const;
    if (previous === lockedThrough) return {lockedThrough,changed:false};
    await tx.company.update({where:{tenantId_id:{tenantId,id:companyId}},data:{ledgerLockedThrough:lockedThrough?new Date(`${lockedThrough}T00:00:00Z`):null}});
    await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:lockedThrough?"ledger-period.locked":"ledger-period.reopened",entity:"Company",entityId:companyId,metadata:{previousLockedThrough:previous,lockedThrough,reason}}});
    return {lockedThrough,changed:true};
  });
  if (result === "missing") return NextResponse.json({error:"Company not found"},{status:404});
  if (result === "stale") return NextResponse.json({error:"Period lock changed. Refresh before saving."},{status:409});
  return NextResponse.json(result,{headers});
}
