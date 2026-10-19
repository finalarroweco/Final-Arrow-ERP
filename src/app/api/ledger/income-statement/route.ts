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
 const parsed=ledgerScope.extend({branchId:z.string().uuid().optional(),from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>from<=to&&(Date.parse(to)-Date.parse(from))/86400000<366).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","from","to","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid income statement filters (maximum 366 days)"},{status:400});
 const {tenantId,companyId,branchId,from,to,format}=parsed.data;
 const branches=await readableCompanyBranches({userId:actor.id,tenantId,companyId,permission:"ledger:read"});
 if(branches===false||(branchId&&branches!==null&&!branches.includes(branchId)))return NextResponse.json({error:"Forbidden"},{status:403});
 const lines=await db.journalLine.findMany({where:{tenantId,companyId,entry:journalWhere(parsed.data,branches),account:{type:{in:["REVENUE","EXPENSE"]}}},select:{accountId:true,debit:true,credit:true,account:{select:{code:true,name:true,type:true}},entry:{select:{currency:true}}},take:20001});
 if(lines.length>20000)return NextResponse.json({error:"Report exceeds 20000 income/expense lines. Narrow the filters."},{status:413});
 const groups=new Map<string,{accountId:string;code:string;name:string;type:string;currency:string;debit:Prisma.Decimal;credit:Prisma.Decimal}>();
 for(const line of lines){const key=JSON.stringify([line.accountId,line.entry.currency]);const g=groups.get(key)??{accountId:line.accountId,...line.account,currency:line.entry.currency,debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0)};g.debit=g.debit.plus(line.debit);g.credit=g.credit.plus(line.credit);groups.set(key,g);}
 const totals=new Map<string,{currency:string;revenue:Prisma.Decimal;expenses:Prisma.Decimal}>();
 const rows=[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.code.localeCompare(b.code)||a.currency.localeCompare(b.currency)).map(g=>{const amount=g.type==="REVENUE"?g.credit.minus(g.debit):g.debit.minus(g.credit);const total=totals.get(g.currency)??{currency:g.currency,revenue:new Prisma.Decimal(0),expenses:new Prisma.Decimal(0)};if(g.type==="REVENUE")total.revenue=total.revenue.plus(amount);else total.expenses=total.expenses.plus(amount);totals.set(g.currency,total);return {...g,debit:g.debit.toFixed(3),credit:g.credit.toFixed(3),amount:amount.toFixed(3)};});
 const summary=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({currency:g.currency,revenue:g.revenue.toFixed(3),expenses:g.expenses.toFixed(3),netIncome:g.revenue.minus(g.expenses).toFixed(3)}));
 const scope=branches===null&&!branchId?"COMPANY":"BRANCHES";
 if(format==="json")return NextResponse.json({from,to,branchId:branchId??null,scope,lineCount:lines.length,rows,summary},{headers:{"Cache-Control":"private, no-store"}});
 const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
 const content=[["Row type","Account code","Current account name","Account type","Currency","Debit movements","Credit movements","Amount","From","To","Scope","Branch filter ID"],...rows.map(r=>["ACCOUNT",r.code,r.name,r.type,r.currency,r.debit,r.credit,r.amount,from,to,scope,branchId??""]),...summary.flatMap(g=>[["REVENUE TOTAL","","","",g.currency,"","",g.revenue,from,to,scope,branchId??""],["EXPENSE TOTAL","","","",g.currency,"","",g.expenses,from,to,scope,branchId??""],["NET INCOME","","","",g.currency,"","",g.netIncome,from,to,scope,branchId??""]])].map(row=>row.map(cell).join(",")).join("\r\n");
 return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="income-statement-${from}-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
