import { NextResponse } from "next/server";
import {z} from "zod";
import { Prisma } from "@prisma/client";
import { currentUser } from "@/lib/auth";
import { readableCompanyBranches } from "@/lib/access";
import { db } from "@/lib/db";
import { journalFilters, journalWhere, queryInput } from "@/lib/ledger";
export async function GET(request: Request) {
  const actor = await currentUser(); if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const params=new URL(request.url).searchParams;
  const format=z.enum(["json","csv"]).safeParse(params.get("format")??"json");
  const parsed = journalFilters.safeParse(queryInput(params, ["tenantId", "companyId", "branchId", "from", "to","format"]));
  if (!parsed.success || !format.success) return NextResponse.json({ error: "Invalid trial balance filters" }, { status: 400 });
  const { tenantId, companyId, branchId } = parsed.data;
  const branches = await readableCompanyBranches({ userId: actor.id, tenantId, companyId, permission: "ledger:read" });
  if (branches === false || (branchId && branches !== null && !branches.includes(branchId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const lines = await db.journalLine.findMany({ where: { tenantId, companyId, entry: journalWhere(parsed.data, branches) },
    select: { accountId: true, debit: true, credit: true, account: { select: { code: true, name: true, type: true } }, entry: { select: { currency: true } } }, take: 20001 });
  if (lines.length > 20000) return NextResponse.json({ error: "Report exceeds 20000 lines. Narrow the dates or branch." }, { status: 413 });
  const groups = new Map<string, { accountId: string; code: string; name: string; type: string; currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>();
  for (const line of lines) {
    const key = `${line.accountId}:${line.entry.currency}`;
    const group = groups.get(key) ?? { accountId: line.accountId, ...line.account, currency: line.entry.currency, debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) };
    group.debit = group.debit.plus(line.debit); group.credit = group.credit.plus(line.credit); groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a,b) => a.code.localeCompare(b.code) || a.currency.localeCompare(b.currency)).map((row) => {
    const balance = row.debit.minus(row.credit);
    return { ...row, debit: row.debit.toFixed(3), credit: row.credit.toFixed(3), debitBalance: balance.gt(0) ? balance.toFixed(3) : "0.000", creditBalance: balance.lt(0) ? balance.negated().toFixed(3) : "0.000" };
  });
  const totals=new Map<string,{currency:string;debit:Prisma.Decimal;credit:Prisma.Decimal;debitBalance:Prisma.Decimal;creditBalance:Prisma.Decimal}>();
  for(const row of rows){const group=totals.get(row.currency)??{currency:row.currency,debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0),debitBalance:new Prisma.Decimal(0),creditBalance:new Prisma.Decimal(0)};for(const field of ["debit","credit","debitBalance","creditBalance"] as const)group[field]=group[field].plus(row[field]);totals.set(row.currency,group);}
  const summary=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({currency:g.currency,debit:g.debit.toFixed(3),credit:g.credit.toFixed(3),debitBalance:g.debitBalance.toFixed(3),creditBalance:g.creditBalance.toFixed(3),balanced:g.debit.equals(g.credit)&&g.debitBalance.equals(g.creditBalance)}));
  if(format.data==="csv"){
   const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
   const content=[["Row type","Account code","Current account name","Account type","Currency","Debit movements","Credit movements","Debit balance","Credit balance","From (inclusive)","To (inclusive)","Scope","Branch filter ID"],...rows.map(r=>["ACCOUNT",r.code,r.name,r.type,r.currency,r.debit,r.credit,r.debitBalance,r.creditBalance,parsed.data.from??"",parsed.data.to??"",branches===null&&!branchId?"COMPANY":"BRANCHES",branchId??""]),...summary.map(g=>["TOTAL","","","",g.currency,g.debit,g.credit,g.debitBalance,g.creditBalance,parsed.data.from??"",parsed.data.to??"",branches===null&&!branchId?"COMPANY":"BRANCHES",branchId??""])].map(row=>row.map(cell).join(",")).join("\r\n");
   return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="trial-balance.csv"',"Cache-Control":"private, no-store"}});
  }
  return NextResponse.json({ rows, summary, lineCount: lines.length, scope: branches === null && !branchId ? "COMPANY" : "BRANCHES", from: parsed.data.from ?? null, to: parsed.data.to ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
