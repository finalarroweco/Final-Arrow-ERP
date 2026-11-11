import type {Prisma} from '@prisma/client';
import {scopeMatches,type GrantScope} from './scope';
/** Request-local authorization snapshot. Caller holds this tenant's SHARE lock.
 * No global cache and no database queries while enumerating companies/branches.
 */
export async function loadDocumentAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string){
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 const grants=member?.status==='ACTIVE'?await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id,role:{permissions:{some:{permissionKey:{in:['document:read','document:manage']}}}}},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:['document:read','document:manage']}},select:{permissionKey:true}}}}}}):[];
 const scopesFor=(key:string):GrantScope[]=>grants.filter(g=>g.role.permissions.some(p=>p.permissionKey===key)).flatMap(g=>g.scopes);
 const read=scopesFor('document:read'),manage=scopesFor('document:manage');
 const target=(scope:{companyId:string;branchId:string|null})=>({companyId:scope.companyId,branchId:scope.branchId??undefined});
 const canRead=(scope:{companyId:string;branchId:string|null})=>read.some(s=>scopeMatches(s,target(scope)));
 const canManage=(scope:{companyId:string;branchId:string|null})=>canRead(scope)&&manage.some(s=>scopeMatches(s,target(scope)));
 const readableBranches=(companyId:string):string[]|null=>canRead({companyId,branchId:null})?null:[...new Set(read.filter(s=>s.type==='BRANCH'&&s.companyId===companyId).flatMap(s=>s.branchId?[s.branchId]:[]))];
 return {canRead,canManage,readableBranches};
}
