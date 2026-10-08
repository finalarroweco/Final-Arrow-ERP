import {NextResponse} from "next/server";
import {Prisma, type PosItem} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import {calculateInvoiceVat,vatTreatment,VatConflict} from "@/lib/invoice-vat";
import {posScope,posNumber} from "@/lib/pos";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=posScope.extend({status:z.enum(["OPEN","PAID","CANCELLED"]).optional(),page:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","status","page"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid order filters"},{status:400});const {tenantId,companyId,branchId,status,page}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const orders=await db.posOrder.findMany({where:{tenantId,companyId,branchId,...(status?{status}:{})},include:{vat:true,lines:{orderBy:{position:"asc"}}},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});
 const profile=await db.companyVatProfile.findUnique({where:{companyId}});
 const vatRequired=Boolean(profile?.tenantId===tenantId&&profile.enabled&&profile.effectiveFrom&&new Date().toISOString().slice(0,10)>=profile.effectiveFrom.toISOString().slice(0,10));
 return NextResponse.json({vatRequired,orders:orders.slice(0,50).map(({creationTransaction,...order})=>{void creationTransaction;return order;}),nextPage:orders.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
const schema=posScope.extend({number:posNumber,type:z.enum(["DINE_IN","TAKEAWAY"]),tableLabel:z.string().trim().max(80).nullish(),note:z.string().trim().max(500).nullish(),lines:z.array(z.object({itemId:z.string().uuid(),quantity:z.number().int().min(1).max(999),treatment:vatTreatment.optional()}).strict()).min(1).max(100)}).strict().refine((v)=>v.type!=="DINE_IN"||!!v.tableLabel);
class MenuConflict extends Error{}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:"Invalid order; dine-in requires a table"},{status:400});const {tenantId,companyId,branchId,lines,...data}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const company=await db.company.findUnique({where:{tenantId_id:{tenantId,id:companyId}},select:{baseCurrency:true}});
 if(!company||!(await db.branch.findUnique({where:{tenantId_companyId_id:{tenantId,companyId,id:branchId}},select:{id:true}})))return NextResponse.json({error:"Branch not found"},{status:404});
 if(new Set(lines.map((line)=>line.itemId)).size!==lines.length)return NextResponse.json({error:"Combine duplicate menu items"},{status:400});
 try{const order=await db.$transaction(async(tx)=>{
   await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
   const createdAt=new Date(),profile=await tx.companyVatProfile.findUnique({where:{companyId}});
   const active=Boolean(profile?.enabled&&profile.effectiveFrom&&createdAt.toISOString().slice(0,10)>=profile.effectiveFrom.toISOString().slice(0,10));
   if(active&&lines.some(l=>!l.treatment))throw new VatConflict("Classify VAT for every order line");
   if(!active&&lines.some(l=>l.treatment))throw new VatConflict("Company VAT is not active for this order date");
   // Lock menu rows in stable order so an unavailable item cannot race order creation.
   const items:PosItem[]=[];
   for(const itemId of lines.map((line)=>line.itemId).sort()){
    const locked=await tx.posItem.updateMany({where:{id:itemId,tenantId,companyId,active:true,currency:company.baseCurrency,OR:[{branchId},{branchId:null}]},data:{active:true}});
    if(locked.count!==1)throw new MenuConflict();
    items.push(await tx.posItem.findUniqueOrThrow({where:{id:itemId}}));
   }
   const snapshots=lines.map((line,position)=>{const item=items.find((item)=>item.id===line.itemId)!;return {itemId:item.id,itemName:item.name,position,quantity:line.quantity,unitPrice:item.price,amount:item.price.mul(line.quantity)};});
   const netAmount=snapshots.reduce((sum,line)=>sum.plus(line.amount),new Prisma.Decimal(0));
   const tax=active?calculateInvoiceVat(snapshots,lines.map((l,position)=>({position,treatment:l.treatment!}))):null;
   const total=netAmount.plus(tax?.taxAmount??0);
   if(total.gt("999999999.999"))throw new VatConflict("Order total exceeds the supported payment range");
   const order=await tx.posOrder.create({data:{tenantId,companyId,branchId,...data,tableLabel:data.type==="DINE_IN"?data.tableLabel:null,currency:company.baseCurrency,total,createdAt,createdBy:actor.id,lines:{create:snapshots}},include:{lines:true}});
   const vat=tax&&profile?await tx.posVat.create({data:{orderId:order.id,tenantId,companyId,netAmount,taxAmount:tax.taxAmount,outputAccountId:profile.outputAccountId!,taxNumber:profile.taxNumber!,sellerName:profile.sellerName!,sellerAddress:profile.sellerAddress!,details:tax.details}}):null;
   await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"pos-order.created",entity:"PosOrder",entityId:order.id}});const {creationTransaction,...result}=order;void creationTransaction;return {...result,vat};
 },{timeout:15000,maxWait:10000});return NextResponse.json({order},{status:201});}
 catch(error){if(error instanceof VatConflict)return NextResponse.json({error:error.message},{status:409});if(error instanceof MenuConflict)return NextResponse.json({error:"Menu item unavailable or outside this branch"},{status:409});if(error instanceof Error&&"code" in error&&error.code==="P2002")return NextResponse.json({error:"Order number already in use"},{status:409});throw error;}
}
