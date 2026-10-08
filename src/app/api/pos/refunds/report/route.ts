import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {posScope} from "@/lib/pos";
import {queryInput} from "@/lib/ledger";
const schema=posScope.extend({from:dueDate,to:dueDate,format:z.enum(["json","csv"]).default("json")}).refine(v=>v.to>=v.from&&(Date.parse(v.to)-Date.parse(v.from))/86400000<31);
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=schema.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","from","to","format"]));if(!parsed.success)return NextResponse.json({error:"Invalid refund report dates (maximum 31 days)"},{status:400});
 const {tenantId,companyId,branchId,from,to,format}=parsed.data,scope={userId:actor.id,tenantId,companyId,branchId};
 if(!(await canAccess({...scope,permission:"pos:read"}))||!(await canAccess({...scope,permission:"ledger:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const refunds=await db.$transaction(tx=>tx.posRefund.findMany({where:{tenantId,companyId,order:{branchId},entry:{entryDate:{gte:new Date(`${from}T00:00:00Z`),lte:new Date(`${to}T00:00:00Z`)}}},include:{order:{select:{number:true,currency:true}},entry:{select:{id:true,number:true,entryDate:true,reversal:{select:{id:true,entryDate:true}}}}},orderBy:[{entry:{entryDate:"asc"}},{id:"asc"}],take:5001}),{isolationLevel:"RepeatableRead"});
 if(refunds.length>5000)return NextResponse.json({error:"Report exceeds 5000 refunds; narrow the dates"},{status:413});
 const groups=new Map<string,{currency:string;count:number;reversedCount:number;netAmount:Prisma.Decimal;taxAmount:Prisma.Decimal;amount:Prisma.Decimal;reversedAmount:Prisma.Decimal}>();
 for(const refund of refunds){const currency=refund.order.currency,g=groups.get(currency)??{currency,count:0,reversedCount:0,netAmount:new Prisma.Decimal(0),taxAmount:new Prisma.Decimal(0),amount:new Prisma.Decimal(0),reversedAmount:new Prisma.Decimal(0)};g.count++;if(refund.entry.reversal){g.reversedCount++;g.reversedAmount=g.reversedAmount.plus(refund.amount);}else{g.netAmount=g.netAmount.plus(refund.netAmount);g.taxAmount=g.taxAmount.plus(refund.taxAmount);g.amount=g.amount.plus(refund.amount);}groups.set(currency,g);}
 const summary=[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({...g,netAmount:g.netAmount.toFixed(3),taxAmount:g.taxAmount.toFixed(3),amount:g.amount.toFixed(3),reversedAmount:g.reversedAmount.toFixed(3)}));
 if(format==="json")return NextResponse.json({from,to,dateBasis:"UTC journal date",stateBasis:"current reversal status",count:refunds.length,summary,refunds:refunds.slice(0,50)},{headers:{"Cache-Control":"private, no-store"}});
 const rows=[["Refund journal date UTC","Order","Refund journal","Status now","Reference","Reason","Net before VAT","VAT","Gross refund","Currency","Reversal journal date UTC"],...refunds.map(f=>[f.entry.entryDate.toISOString().slice(0,10),f.order.number,f.entry.number,f.entry.reversal?"REVERSED":"ACTIVE",f.reference,f.reason,f.netAmount.toFixed(3),f.taxAmount.toFixed(3),f.amount.toFixed(3),f.order.currency,f.entry.reversal?.entryDate.toISOString().slice(0,10)??""])];
 return new Response(`\uFEFF${rows.map(r=>r.map(cell).join(",")).join("\r\n")}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="pos-refunds-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
