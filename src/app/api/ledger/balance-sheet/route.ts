import {moneyMillis,moneyText} from "@/lib/exact-money";
import {NextResponse} from "next/server";
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
 const groups=new Map<string,{accountId:string;code:string;name:string;type:string;currency:string;debit:bigint;credit:bigint}>();
 for(const line of lines){const key=JSON.stringify([line.accountId,line.entry.currency]);const g=groups.get(key)??{accountId:line.accountId,...line.account,currency:line.entry.currency,debit:BigInt(0),credit:BigInt(0)};g.debit+=moneyMillis(line.debit.toFixed(3));g.credit+=moneyMillis(line.credit.toFixed(3));groups.set(key,g);}
 type Totals={currency:string;assets:bigint;liabilities:bigint;equity:bigint;earnings:bigint};const totals=new Map<string,Totals>();
 const rows=[...groups.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.code.localeCompare(b.code)||a.currency.localeCompare(b.currency)).map(g=>{const debitNet=g.debit-g.credit;const amount=["ASSET","EXPENSE"].includes(g.type)?debitNet:-debitNet;const total=totals.get(g.currency)??{currency:g.currency,assets:BigInt(0),liabilities:BigInt(0),equity:BigInt(0),earnings:BigInt(0)};if(g.type==="ASSET")total.assets+=amount;else if(g.type==="LIABILITY")total.liabilities+=amount;else if(g.type==="EQUITY")total.equity+=amount;else total.earnings-=debitNet;totals.set(g.currency,total);return {...g,debit:moneyText(g.debit),credit:moneyText(g.credit),amount:moneyText(amount)};});
 const summary=[...totals.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>{const equityAndEarnings=g.equity+g.earnings;const difference=g.assets-g.liabilities-equityAndEarnings;return {currency:g.currency,assets:moneyText(g.assets),liabilities:moneyText(g.liabilities),equity:moneyText(g.equity),earnings:moneyText(g.earnings),equityAndEarnings:moneyText(equityAndEarnings),difference:moneyText(difference),balanced:difference===BigInt(0)};});
 const scope=branches===null&&!branchId?"COMPANY":"BRANCHES";
 if(format==="json")return NextResponse.json({to,branchId:branchId??null,scope,lineCount:lines.length,rows,summary},{headers:{"Cache-Control":"private, no-store"}});
 const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
 const content=[["Row type","Account code","Current account name","Account type","Currency","Debit movements","Credit movements","Balance","Through date (inclusive)","Scope","Branch filter ID"],...rows.map(r=>["ACCOUNT",r.code,r.name,r.type,r.currency,r.debit,r.credit,r.amount,to,scope,branchId??""]),...summary.flatMap(g=>["assets","liabilities","equity","earnings","equityAndEarnings","difference"].map(field=>[field.toUpperCase(),"","","",g.currency,"","",String(g[field as keyof typeof g]),to,scope,branchId??""]))].map(row=>row.map(cell).join(",")).join("\r\n");
 return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="balance-sheet-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
