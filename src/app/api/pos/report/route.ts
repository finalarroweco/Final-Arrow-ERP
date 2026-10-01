import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {posScope} from "@/lib/pos";
import {queryInput} from "@/lib/ledger";
const schema=posScope.extend({from:dueDate,to:dueDate,timeZone:z.enum(["UTC","Asia/Muscat"]).default("Asia/Muscat"),format:z.enum(["json","csv"]).default("json")})
 .refine(({from,to})=>to>=from&&(Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000<31);
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=schema.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","from","to","timeZone","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid report filters (maximum 31 days)"},{status:400});
 const {tenantId,companyId,branchId,from,to,timeZone,format}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const offset=timeZone==="Asia/Muscat"?"+04:00":"Z";
 const start=new Date(`${from}T00:00:00${offset}`);const end=new Date(Date.parse(`${to}T00:00:00${offset}`)+86400000);
 const orders=await db.posOrder.findMany({where:{tenantId,companyId,branchId,status:"PAID",paidAt:{gte:start,lt:end}},select:{number:true,type:true,total:true,currency:true,paymentMethod:true,paymentReference:true,tendered:true,change:true,paidAt:true},orderBy:[{paidAt:"asc"},{id:"asc"}],take:5001});
 if(orders.length>5000)return NextResponse.json({error:"Report exceeds 5000 orders. Narrow the dates."},{status:413});
 const groups=new Map<string,{method:string;currency:string;count:number;total:Prisma.Decimal;cashReceived:Prisma.Decimal;change:Prisma.Decimal}>();
 for(const order of orders){const method=order.paymentMethod!;const key=`${method}:${order.currency}`;const group=groups.get(key)??{method,currency:order.currency,count:0,total:new Prisma.Decimal(0),cashReceived:new Prisma.Decimal(0),change:new Prisma.Decimal(0)};group.count++;group.total=group.total.plus(order.total);group.cashReceived=group.cashReceived.plus(order.tendered??0);group.change=group.change.plus(order.change??0);groups.set(key,group);}
 const summary=[...groups.values()].sort((a,b)=>a.method.localeCompare(b.method)||a.currency.localeCompare(b.currency)).map(group=>({...group,total:group.total.toFixed(3),cashReceived:group.cashReceived.toFixed(3),change:group.change.toFixed(3)}));
 if(format==="json")return NextResponse.json({from,to,timeZone,count:orders.length,summary},{headers:{"Cache-Control":"private, no-store"}});
 const localTime=(date:Date)=>new Date(date.getTime()+(timeZone==="Asia/Muscat"?4*3600000:0)).toISOString().replace("T"," ").slice(0,19);
 const rows=[["Paid at", "Time zone", "Order", "Type", "Payment method", "Total", "Currency", "Cash received", "Change", "Payment reference"],...orders.map(order=>[localTime(order.paidAt!),timeZone,order.number,order.type,order.paymentMethod!,order.total.toFixed(3),order.currency,order.tendered?.toFixed(3)??"",order.change?.toFixed(3)??"",order.paymentReference??""])];
 return new Response(`\uFEFF${rows.map(row=>row.map(cell).join(",")).join("\r\n")}\r\n`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="pos-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
