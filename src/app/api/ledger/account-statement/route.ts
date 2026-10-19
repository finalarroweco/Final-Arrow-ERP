import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {readableCompanyBranches} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {ledgerScope,journalWhere,queryInput} from "@/lib/ledger";
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=ledgerScope.extend({accountId:z.string().uuid(),branchId:z.string().uuid().optional(),from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>from<=to&&(Date.parse(to)-Date.parse(from))/86400000<366).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","accountId","branchId","from","to","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid statement filters (maximum 366 days)"},{status:400});
 const {tenantId,companyId,accountId,from,to,format,branchId}=parsed.data;
 const branches=await readableCompanyBranches({userId:actor.id,tenantId,companyId,permission:"ledger:read"});
 if(branches===false||(branchId&&branches!==null&&!branches.includes(branchId)))return NextResponse.json({error:"Forbidden"},{status:403});
 const account=await db.ledgerAccount.findFirst({where:{id:accountId,tenantId,companyId},select:{id:true,code:true,name:true,type:true}});if(!account)return NextResponse.json({error:"Account not found"},{status:404});
 const result=await db.$transaction(async tx=>{
  // Each currency gets its own opening balance, including currencies without period movements.
  const openingRows=await tx.journalLine.findMany({where:{tenantId,companyId,accountId,entry:{...journalWhere({tenantId,companyId,branchId},branches),entryDate:{lt:new Date(`${from}T00:00:00Z`)}}},select:{debit:true,credit:true,entry:{select:{currency:true}}},take:20001});
  const lines=await tx.journalLine.findMany({where:{tenantId,companyId,accountId,entry:journalWhere(parsed.data,branches)},select:{id:true,debit:true,credit:true,position:true,entry:{select:{id:true,number:true,entryDate:true,description:true,currency:true,branchId:true,reversalOf:true}}},orderBy:[{entry:{entryDate:"asc"}},{entry:{createdAt:"asc"}},{entryId:"asc"},{position:"asc"}],take:5001});
  if(openingRows.length>20000||lines.length>5000)return null;
  const groups=new Map<string,{currency:string;opening:Prisma.Decimal;debit:Prisma.Decimal;credit:Prisma.Decimal;closing:Prisma.Decimal}>();
  const group=(currency:string)=>{let g=groups.get(currency);if(!g){g={currency,opening:new Prisma.Decimal(0),debit:new Prisma.Decimal(0),credit:new Prisma.Decimal(0),closing:new Prisma.Decimal(0)};groups.set(currency,g);}return g;};
  for(const row of openingRows){const g=group(row.entry.currency);g.opening=g.opening.plus(row.debit).minus(row.credit);g.closing=g.opening;}
  const rows=lines.map(line=>{const g=group(line.entry.currency);g.debit=g.debit.plus(line.debit);g.credit=g.credit.plus(line.credit);g.closing=g.closing.plus(line.debit).minus(line.credit);return {id:line.id,number:line.entry.number,date:line.entry.entryDate.toISOString().slice(0,10),description:line.entry.description,branchId:line.entry.branchId,reversal:!!line.entry.reversalOf,currency:g.currency,debit:line.debit.toFixed(3),credit:line.credit.toFixed(3),balance:g.closing.toFixed(3)};});
  return {rows,summary:[...groups.values()].map(g=>({currency:g.currency,opening:g.opening.toFixed(3),debit:g.debit.toFixed(3),credit:g.credit.toFixed(3),closing:g.closing.toFixed(3)}))};
 },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 if(!result)return NextResponse.json({error:"Statement exceeds 5000 period lines or 20000 earlier lines."},{status:413});
 if(format==="json")return NextResponse.json({account,from,to,branchId:branchId??null,...result},{headers:{"Cache-Control":"private, no-store"}});
 const content=[["Type","Account","Date","Number","Description","Debit","Credit","Balance (debit minus credit)","Currency"],...result.summary.map(g=>["OPENING",account.code,from,"","","","",g.opening,g.currency]),...result.rows.map(r=>[r.reversal?"REVERSAL":"JOURNAL",account.code,r.date,r.number,r.description,r.debit,r.credit,r.balance,r.currency]),...result.summary.map(g=>["CLOSING",account.code,to,"","",g.debit,g.credit,g.closing,g.currency])].map(row=>row.map(cell).join(",")).join("\r\n");
 return new Response(`\uFEFF${content}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="account-statement-${from}-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
