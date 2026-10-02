import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {queryInput} from "@/lib/ledger";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,companyId:uuid,branchId:uuid,itemId:uuid,from:dueDate,to:dueDate,timeZone:z.enum(["UTC","Asia/Muscat"]).default("Asia/Muscat"),format:z.enum(["json","csv"]).default("json")}).refine(({from,to})=>to>=from&&(Date.parse(to)-Date.parse(from))/86400000<366);
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=schema.safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","itemId","from","to","timeZone","format"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid stock report filters (maximum 366 days)"},{status:400});
 const {tenantId,companyId,branchId,itemId,from,to,timeZone,format}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"inventory-stock:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const offset=timeZone==="Asia/Muscat"?14400000:0;const start=new Date(Date.parse(`${from}T00:00:00Z`)-offset);const end=new Date(Date.parse(`${to}T00:00:00Z`)+86400000-offset);
 const result=await db.$transaction(async tx=>{
  const branch=await tx.branch.findUnique({where:{tenantId_companyId_id:{tenantId,companyId,id:branchId}},select:{name:true}});
  const item=await tx.inventoryItem.findFirst({where:{tenantId,companyId,id:itemId,OR:[{branchId},{branchId:null}]},select:{sku:true,name:true,unit:true,archivedAt:true}});
  if(!branch||!item)return null;
  const scope={tenantId,balance:{tenantId,companyId,branchId,itemId}};
  const [prior,movements]=await Promise.all([
   tx.stockMovement.aggregate({where:{...scope,createdAt:{lt:start}},_sum:{delta:true}}),
   tx.stockMovement.findMany({where:{...scope,createdAt:{gte:start,lt:end}},select:{id:true,type:true,delta:true,reason:true,createdAt:true},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001})]);
  let balance=prior._sum.delta??new Prisma.Decimal(0);const opening=balance.toFixed(3);let incoming=new Prisma.Decimal(0);let outgoing=new Prisma.Decimal(0);
  const rows=movements.map(movement=>{balance=balance.plus(movement.delta);if(movement.delta.gt(0))incoming=incoming.plus(movement.delta);else outgoing=outgoing.minus(movement.delta);return {...movement,delta:movement.delta.toFixed(3),balance:balance.toFixed(3),timestamp:new Date(movement.createdAt.getTime()+offset).toISOString().replace("T"," ").slice(0,19)};});
  return {branch:branch.name,item,rows,summary:{opening,incoming:incoming.toFixed(3),outgoing:outgoing.toFixed(3),closing:balance.toFixed(3),count:rows.length}};
 },{isolationLevel:"RepeatableRead"});
 if(!result)return NextResponse.json({error:"Branch or item not found in this scope"},{status:404});
 if(result.rows.length>5000)return NextResponse.json({error:"Report exceeds 5000 movements. Narrow the date range."},{status:413});
 if(format==="json")return NextResponse.json({from,to,timeZone,...result},{headers:{"Cache-Control":"private, no-store"}});
 const prefix=[result.item.sku,result.item.name,result.item.unit,result.branch,timeZone];
 const content=[["SKU","Item","Unit","Branch","Time zone","Time","Type","Delta","Running balance","Reason"],[...prefix,from,"OPENING","",result.summary.opening,"Opening balance summary"],...result.rows.map(row=>[...prefix,row.timestamp,row.type,row.delta,row.balance,row.reason]),[...prefix,to,"CLOSING","",result.summary.closing,"Closing balance summary"]].map(row=>row.map(cell).join(",")).join("\r\n")+"\r\n";
 return new Response(`\uFEFF${content}`,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="stock-${from}-to-${to}.csv"`,"Cache-Control":"private, no-store"}});
}
