import type {Prisma} from '@prisma/client';
import {scopeMatches,type GrantScope} from './scope';
/** Request-local authorization. Call after taking this tenant's SHARE lock. */
export async function loadReorderAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string){
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 const keys=['inventory-stock:read','inventory-reorder:manage'];
 const grants=member?.status==='ACTIVE'?await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id,role:{permissions:{some:{permissionKey:{in:keys}}}}},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:keys}},select:{permissionKey:true}}}}}}):[];
 const scopesFor=(key:string):GrantScope[]=>grants.filter(g=>g.role.permissions.some(p=>p.permissionKey===key)).flatMap(g=>g.scopes);
 const read=scopesFor(keys[0]),manage=scopesFor(keys[1]);
 const canRead=(scope:{companyId:string;branchId:string})=>read.some(s=>scopeMatches(s,scope));
 const canManage=(scope:{companyId:string;branchId:string})=>canRead(scope)&&manage.some(s=>scopeMatches(s,scope));
 return {canRead,canManage};
}
