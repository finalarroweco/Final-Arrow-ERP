import {invoiceGross} from "./invoice-vat";
import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "./auth";
import {readableCompanyBranches} from "./access";
import {db} from "./db";
import {dueDate} from "./date";
import {queryInput} from "./ledger";
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function financialReport(request:Request,kind:"expenses"|"invoices"|"purchase-orders"){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const schema=z.object({tenantId:z.string().uuid(),companyId:z.string().uuid(),from:dueDate,to:dueDate,branchId:z.string().uuid().optional(),status:(kind==="expenses"?z.enum(["DRAFT","POSTED","VOID"]):kind==="purchase-orders"?z.enum(["DRAFT","ISSUED","RECEIVED","CANCELLED"]):z.enum(["DRAFT","ISSUED","VOID"])).optional(),q:z.string().trim().max(120).optional(),format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>to>=from&&(Date.parse(to)-Date.parse(from))/86400000<366);
 const parsed=schema.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","from","to","branchId","status","q","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid financial report filters (maximum 366 days)"},{status:400});
 const {tenantId,companyId,from,to,branchId,status,q,format}=parsed.data;
 const branches=await readableCompanyBranches({userId:actor.id,tenantId,companyId,permission:kind==="expenses"?"expense:read":kind==="purchase-orders"?"purchase-order:read":"invoice:read"});
 if(branches===false||(branchId&&branches!==null&&!branches.includes(branchId)))return NextResponse.json({error:"Forbidden"},{status:403});
 const scope={tenantId,companyId,...(branchId?{branchId}:branches===null?{}:{branchId:{in:branches}})};
 const start=new Date(`${from}T00:00:00Z`);const end=new Date(`${to}T00:00:00Z`);const nextDay=new Date(end.getTime()+86400000);
 const purchaseRows=kind==="purchase-orders"?await db.purchaseOrder.findMany({where:{...scope,createdAt:{gte:start,lt:nextDay},...(status?{status:status as "DRAFT"|"ISSUED"|"RECEIVED"|"CANCELLED"}:{}),...(q?{OR:[{number:{contains:q,mode:"insensitive"}},{supplierName:{contains:q,mode:"insensitive"}}]}:{})},select:{number:true,createdAt:true,supplierId:true,supplierName:true,subtotal:true,currency:true,status:true,branchId:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001}):[];
 const rows=kind==="purchase-orders"?purchaseRows.map(row=>({number:row.number,date:row.createdAt.toISOString().slice(0,10),description:row.supplierName,category:"",amount:row.subtotal,currency:row.currency,status:row.status,branchId:row.branchId})):kind==="expenses"?(await db.expense.findMany({where:{...scope,expenseDate:{gte:start,lte:end},...(status?{status:status as "DRAFT"|"POSTED"|"VOID"}:{}),...(q?{OR:[{number:{contains:q,mode:"insensitive"}},{description:{contains:q,mode:"insensitive"}},{category:{contains:q,mode:"insensitive"}}]}:{})},select:{number:true,expenseDate:true,description:true,category:true,amount:true,currency:true,status:true,branchId:true},orderBy:[{expenseDate:"asc"},{id:"asc"}],take:5001})).map(row=>({...row,date:row.expenseDate.toISOString().slice(0,10)})):
 (await db.invoice.findMany({where:{...scope,createdAt:{gte:start,lt:nextDay},...(status?{status:status as "DRAFT"|"ISSUED"|"VOID"}:{}),...(q?{OR:[{number:{contains:q,mode:"insensitive"}},{customerName:{contains:q,mode:"insensitive"}}]}:{})},select:{number:true,createdAt:true,customerName:true,subtotal:true,vat:{select:{taxAmount:true}},currency:true,status:true,branchId:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001})).map(row=>({number:row.number,date:row.createdAt.toISOString().slice(0,10),description:row.customerName,category:"",amount:invoiceGross(row),currency:row.currency,status:row.status,branchId:row.branchId}));
 if(rows.length>5000)return NextResponse.json({error:"Report exceeds 5000 records. Narrow the filters."},{status:413});
 const names=new Map((await db.branch.findMany({where:{tenantId,companyId,id:{in:[...new Set(rows.flatMap(row=>row.branchId?[row.branchId]:[]))]}},select:{id:true,name:true}})).map(branch=>[branch.id,branch.name]));
 type Group={status:string;currency:string;category:string;count:number;amount:Prisma.Decimal};
 const totals=new Map<string,Group>();const categories=new Map<string,Group>();
 for(const row of rows){for(const [map,category] of [[totals,""] as const,...(kind==="expenses"?[[categories,row.category] as const]:[])]){const key=JSON.stringify([row.status,row.currency,category]);const group=map.get(key)??{status:row.status,currency:row.currency,category,count:0,amount:new Prisma.Decimal(0)};group.count++;group.amount=group.amount.plus(row.amount);map.set(key,group);}}
 const serialize=(map:Map<string,Group>)=>[...map.values()].map(group=>({...group,amount:group.amount.toFixed(3)}));
 const suppliers=new Map<string,{supplierId:string;supplierName:string;status:string;currency:string;count:number;amount:Prisma.Decimal}>();
 for(const row of purchaseRows){const key=JSON.stringify([row.supplierId,row.supplierName,row.status,row.currency]);const group=suppliers.get(key)??{supplierId:row.supplierId,supplierName:row.supplierName,status:row.status,currency:row.currency,count:0,amount:new Prisma.Decimal(0)};group.count++;group.amount=group.amount.plus(row.subtotal);suppliers.set(key,group);}
 if(format==="json")return NextResponse.json({from,to,branchId:branchId??null,status:status??null,q:q??"",dateBasis:kind==="expenses"?"expenseDate":"createdAtUTC",count:rows.length,summary:serialize(totals),categories:serialize(categories),suppliers:[...suppliers.values()].map(group=>({...group,amount:group.amount.toFixed(3)}))},{headers:{"Cache-Control":"private, no-store"}});
 const content=[["Number",kind==="expenses"?"Expense date":"Created date UTC",kind==="expenses"?"Description":kind==="purchase-orders"?"Supplier":"Customer", "Category","Branch","Status","Amount","Currency"],...rows.map(row=>[row.number,row.date,row.description,row.category,row.branchId?names.get(row.branchId)??"":"Company wide",row.status,row.amount.toFixed(3),row.currency])].map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
 return new Response(`\uFEFF${content}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${kind}-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
