import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {queryInput} from "@/lib/ledger";
import {uuid,operationalParent,operationalAudit,operationalFailure,OperationalError} from "@/lib/operational-records";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","page"]));if(!p.success)return NextResponse.json({error:"Invalid message filters"},{status:400});
 try{const {tenantId,page}=p.data;await operationalParent("ticket",id,tenantId,actor.id);const records=await db.ticketMessage.findMany({where:{tenantId,ticketId:id},orderBy:[{createdAt:"desc"},{id:"desc"}],skip:page*50,take:51});const users=await db.user.findMany({where:{id:{in:[...new Set(records.slice(0,50).map(m=>m.createdBy))]}},select:{id:true,name:true}}),names=new Map(users.map(u=>[u.id,u.name]));return NextResponse.json({messages:records.slice(0,50).map(m=>({...m,authorName:names.get(m.createdBy)??null})),nextPage:records.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=z.object({tenantId:uuid,requestId:uuid,body:z.string().trim().min(1).max(4000)}).strict().safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid internal note"},{status:400});
 try{const {tenantId,requestId,body}=p.data,parent=await operationalParent("ticket",id,tenantId,actor.id,true);const result=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Ticket" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 const existing=await tx.ticketMessage.findUnique({where:{id:requestId}});if(existing){if(existing.tenantId!==tenantId||existing.ticketId!==id||existing.createdBy!==actor.id||existing.body!==body)throw new OperationalError("Request ID already used");return {message:existing,replayed:true};}
 const message=await tx.ticketMessage.create({data:{id:requestId,tenantId,companyId:parent.companyId,ticketId:id,body,createdBy:actor.id}});await operationalAudit(tx,tenantId,actor.id,"TicketMessage",message.id,"ticket-message.created",id);return {message,replayed:false};},{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
