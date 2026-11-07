import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {uuid,contactFields,operationalParent,operationalAudit,operationalFailure,OperationalError} from "@/lib/operational-records";
const schema=z.discriminatedUnion("action",[z.object({tenantId:uuid,expectedVersion:z.number().int().min(1).max(2147483646),action:z.literal("update"),...contactFields}).strict(),z.object({tenantId:uuid,expectedVersion:z.number().int().min(1).max(2147483646),action:z.literal("archive"),archived:z.boolean()}).strict()]);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string;contactId:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id,contactId}=await params,p=schema.safeParse(await request.json().catch(()=>null));if(!p.success||!uuid.safeParse(contactId).success)return NextResponse.json({error:"Invalid contact change"},{status:400});
 try{const {tenantId,expectedVersion}=p.data;await operationalParent("customer",id,tenantId,actor.id,true);const contact=await db.$transaction(async tx=>{
 await tx.$queryRaw`SELECT id FROM "Customer" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 const existing=await tx.customerContact.findFirst({where:{id:contactId,tenantId,customerId:id}});if(!existing)throw new OperationalError("Contact not found",404);if(existing.version!==expectedVersion)throw new OperationalError("Contact changed. Reload before editing.");
 if(p.data.action==="update"&&existing.archivedAt)throw new OperationalError("Restore the contact before editing");
 if(p.data.action==="archive"&&Boolean(existing.archivedAt)===p.data.archived)return existing;
 const update=p.data.action==="archive"?{archivedAt:p.data.archived?new Date():null}:{displayName:p.data.displayName,email:p.data.email,phone:p.data.phone,title:p.data.title,notes:p.data.notes};
 const changed=await tx.customerContact.update({where:{id:contactId},data:{...update,version:expectedVersion+1,updatedBy:actor.id}});
 await operationalAudit(tx,tenantId,actor.id,"CustomerContact",contactId,p.data.action==="update"?"customer-contact.updated":p.data.archived?"customer-contact.archived":"customer-contact.restored",id,changed.version);return changed;
 },{timeout:15000,maxWait:10000});return NextResponse.json({contact});}catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
