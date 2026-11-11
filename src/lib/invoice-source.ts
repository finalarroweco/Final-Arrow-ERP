import type {Prisma} from '@prisma/client';
import {canAccess} from './access';
import {db} from './db';
export type InvoiceSourceRights=string[]|null|false;
/** An OR of independently authorized source kinds, never an unguarded fallback. */
export function invoiceSourceWhere(order:InvoiceSourceRights,billing:InvoiceSourceRights):Prisma.InvoiceWhereInput {
 const OR:Prisma.InvoiceWhereInput[]=[];
 if(order!==false)OR.push({orderId:{not:null},serviceSourceId:null,order:{is:order===null?{}:{branchId:{in:order}}}});
 if(billing!==false)OR.push({orderId:null,serviceSourceId:{not:null},serviceSource:{is:billing===null?{}:{branchId:{in:billing}}}});
 return {OR};
}
export const invoiceSourceInclude={order:{select:{branchId:true}},serviceSource:{select:{branchId:true,subscriptionId:true}},customer:{select:{branchId:true}}} as const;
export const invoiceSourceSelect={orderId:true,serviceSourceId:true,...invoiceSourceInclude} as const;
type SourceProjection={tenantId:string;companyId:string;orderId:string|null;serviceSourceId:string|null;order:{branchId:string|null}|null;serviceSource:{branchId:string|null}|null;customer:{branchId:string|null}};
export async function invoiceSourceAllowed(userId:string,invoice:SourceProjection,tx:Prisma.TransactionClient=db){
 const scope={userId,tenantId:invoice.tenantId,companyId:invoice.companyId};
 const order=invoice.orderId!==null&&invoice.serviceSourceId===null&&invoice.order!==null&&invoice.serviceSource===null;
 const service=invoice.orderId===null&&invoice.serviceSourceId!==null&&invoice.order===null&&invoice.serviceSource!==null;
 if(!order&&!service)return false;
 return (await Promise.all([canAccess({...scope,branchId:invoice.customer.branchId??undefined,permission:'customer:read'},tx),canAccess({...scope,branchId:(order?invoice.order!.branchId:invoice.serviceSource!.branchId)??undefined,permission:order?'order:read':'billing-subscription:read'},tx)])).every(Boolean);
}

/** Registers, print, invoice terms and document posting historically authorize
 * real-order invoices through the invoice's own scope. Do not retroactively
 * require customer/order grants there. New service documents add both scopes. */
export function invoiceDocumentWhere(billing:InvoiceSourceRights,customers:InvoiceSourceRights):Prisma.InvoiceWhereInput {
 const OR:Prisma.InvoiceWhereInput[]=[{orderId:{not:null},serviceSourceId:null,order:{is:{}}}];
 if(billing!==false&&customers!==false)OR.push({orderId:null,serviceSourceId:{not:null},serviceSource:{is:billing===null?{}:{branchId:{in:billing}}},customer:customers===null?{}:{branchId:{in:customers}}});
 return {OR};
}
export async function invoiceDocumentSourceAllowed(userId:string,invoice:SourceProjection,tx:Prisma.TransactionClient=db){
 if(invoice.orderId!==null&&invoice.serviceSourceId===null&&invoice.order!==null&&invoice.serviceSource===null)return true;
 return invoiceSourceAllowed(userId,invoice,tx);
}
