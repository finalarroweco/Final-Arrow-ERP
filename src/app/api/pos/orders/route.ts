import {NextResponse} from "next/server";
import {Prisma, type PosItem} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import {posScope,posNumber} from "@/lib/pos";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=posScope.extend({status:z.enum(["OPEN","PAID","CANCELLED"]).optional(),page:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","status","page"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid order filters"},{status:400});const {tenantId,companyId,branchId,status,page}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const orders=await db.posOrder.findMany({where:{tenantId,companyId,branchId,...(status?{status}:{})},include:{lines:{orderBy:{position:"asc"}}},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});
 return NextResponse.json({orders:orders.slice(0,50),nextPage:orders.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
const schema=posScope.extend({number:posNumber,type:z.enum(["DINE_IN","TAKEAWAY"]),tableLabel:z.string().trim().max(80).nullish(),note:z.string().trim().max(500).nullish(),lines:z.array(z.object({itemId:z.string().uuid(),quantity:z.number().int().min(1).max(999)}).strict()).min(1).max(100)}).strict().refine((v)=>v.type!=="DINE_IN"||!!v.tableLabel);
class MenuConflict extends Error{}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Invalid order; dine-in requires a table"},{status:400});const {tenantId,companyId,branchId,lines,...data}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const company=await db.company.findUnique({where:{tenantId_id:{tenantId,id:companyId}},select:{baseCurrency:true}});
 if(!company||!(await db.branch.findUnique({where:{tenantId_companyId_id:{tenantId,companyId,id:branchId}},select:{id:true}})))return NextResponse.json({error:"Branch not found"},{status:404});
 if(new Set(lines.map((line)=>line.itemId)).size!==lines.length)return NextResponse.json({error:"Combine duplicate menu items"},{status:400});
 try{const order=await db.$transaction(async(tx)=>{
   // Lock menu rows in stable order so an unavailable item cannot race order creation.
   const items:PosItem[]=[];
   for(const itemId of lines.map((line)=>line.itemId).sort()){
    const locked=await tx.posItem.updateMany({where:{id:itemId,tenantId,companyId,active:true,currency:company.baseCurrency,OR:[{branchId},{branchId:null}]},data:{active:true}});
    if(locked.count!==1)throw new MenuConflict();
    items.push(await tx.posItem.findUniqueOrThrow({where:{id:itemId}}));
   }
   const snapshots=lines.map((line,position)=>{const item=items.find((item)=>item.id===line.itemId)!;return {itemId:item.id,itemName:item.name,position,quantity:line.quantity,unitPrice:item.price,amount:item.price.mul(line.quantity)};});
   const total=snapshots.reduce((sum,line)=>sum.plus(line.amount),new Prisma.Decimal(0));
   const order=await tx.posOrder.create({data:{tenantId,companyId,branchId,...data,tableLabel:data.type==="DINE_IN"?data.tableLabel:null,currency:company.baseCurrency,total,createdBy:actor.id,lines:{create:snapshots}},include:{lines:true}});
   await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"pos-order.created",entity:"PosOrder",entityId:order.id}});return order;
 });return NextResponse.json({order},{status:201});}
 catch(error){if(error instanceof MenuConflict)return NextResponse.json({error:"Menu item unavailable or outside this branch"},{status:409});if(error instanceof Error&&"code" in error&&error.code==="P2002")return NextResponse.json({error:"Order number already in use"},{status:409});throw error;}
}
