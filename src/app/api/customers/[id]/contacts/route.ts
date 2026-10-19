import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import {uuid,contactFields,operationalParent,operationalAudit,operationalFailure,OperationalError} from "@/lib/operational-records";
const create=z.object({tenantId:uuid,requestId:uuid,...contactFields}).strict();
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await params,p=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),archived:z.enum(["true","false"]).default("false"),q:z.string().trim().max(120).default("")}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","page","archived","q"]));if(!p.success)return NextResponse.json({error:"Invalid contact filters"},{status:400});
 try{const {tenantId,page,archived,q}=p.data;await operationalParent("customer",id,tenantId,actor.id);const records=await db.customerContact.findMany({where:{tenantId,customerId:id,archivedAt:archived==="true"?{not:null}:null,...(q?{OR:[{displayName:{contains:q,mode:"insensitive"}},{email:{contains:q,mode:"insensitive"}},{phone:{contains:q,mode:"insensitive"}}]}:{})},orderBy:[{displayName:"asc"},{id:"asc"}],take:51,skip:page*50});return NextResponse.json({contacts:records.slice(0,50),nextPage:records.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=create.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid contact"},{status:400});
 try{const {tenantId,requestId,...fields}=p.data,parent=await operationalParent("customer",id,tenantId,actor.id,true);
 const result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 const existing=await tx.customerContact.findUnique({where:{id:requestId}});if(existing){if(existing.tenantId!==tenantId||existing.customerId!==id||existing.createdBy!==actor.id||existing.version!==1||Object.entries(fields).some(([key,value])=>existing[key as keyof typeof fields]!==value))throw new OperationalError("Request ID already used or contact changed");return {contact:existing,replayed:true};}
 const contact=await tx.customerContact.create({data:{id:requestId,tenantId,companyId:parent.companyId,customerId:id,...fields,createdBy:actor.id,updatedBy:actor.id}});await operationalAudit(tx,tenantId,actor.id,"CustomerContact",contact.id,"customer-contact.created",id);return {contact,replayed:false};},{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});
 }catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
