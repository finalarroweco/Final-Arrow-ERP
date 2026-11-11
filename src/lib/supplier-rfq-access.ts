import type {Prisma} from '@prisma/client';
import {scopeMatches,type GrantScope} from './scope';
export async function loadRfqAccess(tx:Prisma.TransactionClient,actorId:string,tenantId:string){
 const keys=['rfq:read','rfq:manage','supplier:read','purchase-order:read','purchase-order:create'];
 const member=await tx.membership.findUnique({where:{tenantId_userId:{tenantId,userId:actorId}},select:{id:true,status:true}});
 const grants=member?.status==='ACTIVE'?await tx.roleGrant.findMany({where:{tenantId,membershipId:member.id,role:{permissions:{some:{permissionKey:{in:keys}}}}},select:{scopes:true,role:{select:{permissions:{where:{permissionKey:{in:keys}},select:{permissionKey:true}}}}}}):[];
 const scopesFor=(key:string):GrantScope[]=>grants.filter(g=>g.role.permissions.some(p=>p.permissionKey===key)).flatMap(g=>g.scopes);
 type Scope={companyId:string;branchId:string|null};
 const permits=(key:string,s:Scope)=>scopesFor(key).some(g=>scopeMatches(g,{companyId:s.companyId,branchId:s.branchId??undefined}));
 const canRead=(s:Scope)=>permits('rfq:read',s),canManage=(s:Scope)=>canRead(s)&&permits('rfq:manage',s),canReadSupplier=(s:Scope)=>permits('supplier:read',s),canReadPurchaseOrder=(s:Scope)=>permits('purchase-order:read',s),canAward=(s:Scope)=>canManage(s)&&canReadPurchaseOrder(s)&&permits('purchase-order:create',s);
 const supplierBranches=(companyId:string):string[]|null=>canReadSupplier({companyId,branchId:null})?null:[...new Set(scopesFor('supplier:read').filter(s=>s.type==='BRANCH'&&s.companyId===companyId).flatMap(s=>s.branchId?[s.branchId]:[]))];
 return {canRead,canManage,canReadSupplier,canReadPurchaseOrder,canAward,supplierBranches};
}
