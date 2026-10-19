import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "./auth";
import {readableCompanyBranches} from "./access";
import {db} from "./db";
import {dueDate} from "./date";
import {queryInput} from "./ledger";
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function salesReport(request:Request,kind:"quotes"|"orders"){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=z.object({tenantId:z.string().uuid(),companyId:z.string().uuid(),from:dueDate,to:dueDate,branchId:z.string().uuid().optional(),status:(kind==="quotes"?z.enum(["DRAFT","SENT","ACCEPTED","REJECTED"]):z.enum(["NEW","IN_PROGRESS","COMPLETED","CANCELLED"])).optional(),q:z.string().trim().max(120).optional(),format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>to>=from&&(Date.parse(to)-Date.parse(from))/86400000<366).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","from","to","branchId","status","q","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid sales report filters (maximum 366 days)"},{status:400});
 const {tenantId,companyId,from,to,branchId,status,q,format}=parsed.data;
 const branches=await readableCompanyBranches({userId:actor.id,tenantId,companyId,permission:kind==="quotes"?"quote:read":"order:read"});
 if(branches===false||(branchId&&branches!==null&&!branches.includes(branchId)))return NextResponse.json({error:"Forbidden"},{status:403});
 const scope={tenantId,companyId,...(branchId?{branchId}:branches===null?{}:{branchId:{in:branches}}),createdAt:{gte:new Date(`${from}T00:00:00Z`),lt:new Date(Date.parse(`${to}T00:00:00Z`)+86400000)}};
 const rows=kind==="quotes"?(await db.quote.findMany({where:{...scope,...(status?{status:status as "DRAFT"|"SENT"|"ACCEPTED"|"REJECTED"}:{}),...(q?{OR:[{number:{contains:q,mode:"insensitive"}},{customer:{displayName:{contains:q,mode:"insensitive"}}}]}:{})},select:{number:true,createdAt:true,status:true,currency:true,subtotal:true,branchId:true,customer:{select:{displayName:true}}},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001})).map(row=>({...row,customerName:row.customer.displayName})):
 await db.salesOrder.findMany({where:{...scope,...(status?{status:status as "NEW"|"IN_PROGRESS"|"COMPLETED"|"CANCELLED"}:{}),...(q?{OR:[{number:{contains:q,mode:"insensitive"}},{customerName:{contains:q,mode:"insensitive"}}]}:{})},select:{number:true,createdAt:true,status:true,currency:true,subtotal:true,branchId:true,customerName:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001});
 if(rows.length>5000)return NextResponse.json({error:"Report exceeds 5000 records. Narrow the filters."},{status:413});
 const totals=new Map<string,{status:string;currency:string;count:number;amount:Prisma.Decimal}>();
 for(const row of rows){const key=JSON.stringify([row.status,row.currency]);const group=totals.get(key)??{status:row.status,currency:row.currency,count:0,amount:new Prisma.Decimal(0)};group.count++;group.amount=group.amount.plus(row.subtotal);totals.set(key,group);}
 if(format==="json")return NextResponse.json({from,to,branchId:branchId??null,status:status??null,q:q??"",dateBasis:"createdAtUTC",customerNameBasis:kind==="quotes"?"current":"snapshot",count:rows.length,summary:[...totals.values()].map(group=>({...group,category:"",amount:group.amount.toFixed(3)})),categories:[],suppliers:[]},{headers:{"Cache-Control":"private, no-store"}});
 const names=new Map((await db.branch.findMany({where:{tenantId,companyId,id:{in:[...new Set(rows.flatMap(row=>row.branchId?[row.branchId]:[]))]}},select:{id:true,name:true}})).map(branch=>[branch.id,branch.name]));
 const content=[["Number","Created date UTC",kind==="quotes"?"Current customer name":"Saved customer name","Branch","Status","Amount","Currency"],...rows.map(row=>[row.number,row.createdAt.toISOString().slice(0,10),row.customerName,row.branchId?names.get(row.branchId)??"":"Company wide",row.status,row.subtotal.toFixed(3),row.currency])].map(line=>line.map(cell).join(",")).join("\r\n")+"\r\n";
 return new Response(`\uFEFF${content}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="${kind}-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
