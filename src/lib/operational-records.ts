import {Prisma} from "@prisma/client";
import {uuid} from "./operational-input";
export {uuid,contactFields} from "./operational-input";
import {db} from "./db";
import {canAccess} from "./access";
export class OperationalError extends Error{constructor(message:string,public status=409){super(message);}}
export async function operationalParent(kind:"customer"|"ticket",id:string,tenantId:string,userId:string,write=false){
 if(!uuid.safeParse(id).success)throw new OperationalError("Invalid source",400);
 const source=kind==="customer"?await db.customer.findUnique({where:{tenantId_id:{tenantId,id}},select:{id:true,companyId:true,branchId:true,displayName:true,archivedAt:true}}):await db.ticket.findUnique({where:{tenantId_id:{tenantId,id}},select:{id:true,companyId:true,branchId:true,subject:true,status:true}});
 if(!source)throw new OperationalError("Source not found",404);
 for(const permission of [kind+":read",...(write?[kind==="customer"?"customer:update":"ticket:manage"]:[])])if(!(await canAccess({userId,tenantId,companyId:source.companyId,branchId:source.branchId??undefined,permission})))throw new OperationalError("Forbidden",403);
 return source;
}
export async function operationalAudit(tx:Prisma.TransactionClient,tenantId:string,actorId:string,entity:string,entityId:string,action:string,parentId:string,version=1){
 const [clock]=await tx.$queryRaw<{transaction:string}[]>`SELECT txid_current()::text AS transaction`;
 await tx.auditLog.create({data:{tenantId,actorId,entity,entityId,action,metadata:{parentId,version,transaction:clock.transaction}}});
}
export function operationalFailure(error:unknown){
 if(error instanceof OperationalError)return {error:error.message,status:error.status};
 if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004"].includes(error.code))return {error:"Record changed, is closed, or reached its record limit",status:409};
 if(error instanceof Error&&error.name==="PrismaClientUnknownRequestError"&&error.message.includes('code: "23514"'))return {error:"Record changed, is closed, or reached its record limit",status:409};
 throw error;
}
