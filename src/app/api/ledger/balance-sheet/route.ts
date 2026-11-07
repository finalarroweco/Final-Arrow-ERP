import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {readableCompanyBranches} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {ledgerScope,journalWhere,queryInput} from "@/lib/ledger";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=ledgerScope.extend({branchId:z.string().uuid().optional(),to:dueDate,format:z.enum(["json","csv"]).default("json")}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","to","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid balance sheet filters"},{status:400});
 const {tenantId,companyId,branchId,to,format}=parsed.data;
 const branches=await readableCompanyBranches({userId:actor.id,tenantId,companyId,permission:"ledger:read"});
 if(branches===false||(branchId&&branches!==null&&!branches.includes(branchId)))return NextResponse.json({error:"Forbidden"},{status:403});
 const lines=await db.journalLine.findMany({where:{tenantId,companyId,entry:journalWhere(parsed.data,branches)},select:{accountId:true,debit:true,credit:true,account:{select:{code:true,name:true,type:true}},entry:{select:{currency:true}}},take:20001});
 if(lines.length>20000)return NextResponse.json({error:"Report exceeds 20000 lines. Narrow the branch or end date."},{status:413});
 const groups=new Map<string,{accountId:string;code:string;name:string;type:string;currency:string;debit:Prisma.Decimal;credit:Prisma.Decimal}>();
 for(const line of lines){const key=JSON.stringify([line.accountId,line.entry.currency]);const g=groups.get(key)??{accountId:line.accountId,...line.account,currency:line.entry.currency,debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};g.debit=g.debit.plus(line.debit);g.credit=g.credit.plus(line.credit);groups.set(key,g);}
 type Totals={currency:string;assets:Prisma.Decimal;liabilities:Prisma.Decimal;equity:Prisma.Decimal;earnings:Prisma.Decimal};const totals=new Map<string,Totals>();
 const rows=[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.code.localeCompare(b.code)||a.currency.localeCompare(b.currency)).map(g=>{const debitNet=g.debit.minus(g.credit);const amount=["ASSET","EXPENSE"].includes(g.type)?debitNet:debitNet.negated();const total=totals.get(g.currency)??{currency:g.currency,assets:new Prisma.Decimal(0),liabilities:new Prisma.Decimal(0),equity:new Prisma.Decimal(0),earnings:new Prisma.Decimal(0)};if(g.type==="ASSET")total.assets=total.assets.plus(amount);else if(g.type==="LIABILITY")total.liabilities=total.liabilities.plus(amount);else if(g.type==="EQUITY")total.equity=total.equity.plus(amount);else total.earnings=total.earnings.minus(debitNet);totals.set(g.currency,total);return {...g,debit:g.debit.toFixed(3),credit:g.credit.toFixed(3),amount:amount.toFixed(3)};});
 const summary=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>{const equityAndEarnings=g.equity.plus(g.earnings);const difference=g.assets.minus(g.liabilities).minus(equityAndEarnings);return {currency:g.currency,assets:g.assets.toFixed(3),liabilities:g.liabilities.toFixed(3),equity:g.equity.toFixed(3),earnings:g.earnings.toFixed(3),equityAndEarnings:equityAndEarnings.toFixed(3),difference:difference.toFixed(3),balanced:difference.isZero()};});
 const scope=branches===null&&!branchId?"COMPANY":"BRANCHES";
 if(format==="json")return NextResponse.json({to,branchId:branchId??null,scope,lineCount:lines.length,rows,summary},{headers:{"Cache-Control":"private, no-store"}});
 const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
 const content=[["Row type","Account code","Current account name","Account type","Currency","Debit movements","Credit movements","Balance","Through date (inclusive)","Scope","Branch filter ID"],...rows.map(r=>["ACCOUNT",r.code,r.name,r.type,r.currency,r.debit,r.credit,r.amount,to,scope,branchId??""]),...summary.flatMap(g=>["assets","liabilities","equity","earnings","equityAndEarnings","difference"].map(field=>[field.toUpperCase(),"","","",g.currency,"","",String(g[field as keyof typeof g]),to,scope,branchId??""]))].map(row=>row.map(cell).join(",")).join("\r\n");
 return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="balance-sheet-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
