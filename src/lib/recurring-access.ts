import type {Prisma} from '@prisma/client';
import {scopeMatches,type GrantScope} from './scope';
const keys=['billing-subscription:read','billing-subscription:manage','billing-subscription:generate','customer:read','invoice:read','invoice:create','subscription:read'];
export async function loadBillingAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string){
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 const grants=member?.status==='ACTIVE'?await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id,role:{permissions:{some:{permissionKey:{in:keys}}}}},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:keys}},select:{permissionKey:true}}}}}}):[];
 const scopesFor=(key:string):GrantScope[]=>grants.filter(g=>g.role.permissions.some(p=>p.permissionKey===key)).flatMap(g=>g.scopes);
 const can=(key:string,scope:{companyId:string;branchId:string|null})=>scopesFor(key).some(s=>scopeMatches(s,{companyId:scope.companyId,branchId:scope.branchId??undefined}));
 const branches=(key:string,companyId:string):string[]|null=>can(key,{companyId,branchId:null})?null:[...new Set(scopesFor(key).filter(s=>s.type==='BRANCH'&&s.companyId===companyId).flatMap(s=>s.branchId?[s.branchId]:[]))];
 return {can,branches};
}
