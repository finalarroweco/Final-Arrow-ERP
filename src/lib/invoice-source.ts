import type {Prisma} from '@prisma/client';
import {canAccess} from './access';
import {db} from './db';
export type InvoiceSourceRights=string[]|null|false;
/** An OR of independently authorized source kinds, never an unguarded fallback. */
export function invoiceSourceWhere(order:InvoiceSourceRights,billing:InvoiceSourceRights,project:InvoiceSourceRights=false,time:InvoiceSourceRights=false,timeInvoice:InvoiceSourceRights=false,milestone:InvoiceSourceRights=false):Prisma.InvoiceWhereInput {
 const OR:Prisma.InvoiceWhereInput[]=[];
 if(order!==false)OR.push({projectMilestoneSourceId:null,orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,order:{is:order===null?{}:{branchId:{in:order}}}});
 if(billing!==false)OR.push({projectMilestoneSourceId:null,orderId:null,projectTimeSourceId:null,serviceSourceId:{not:null},serviceSource:{is:billing===null?{}:{branchId:{in:billing}}}});
 if(project!==false&&time!==false&&timeInvoice!==false)OR.push({projectMilestoneSourceId:null,orderId:null,serviceSourceId:null,projectTimeSourceId:{not:null},projectTimeSource:{is:{AND:[project,time,timeInvoice].map(right=>right===null?{}:{branchId:{in:right as string[]}})}}});
 if(project!==false&&milestone!==false)OR.push({orderId:null,serviceSourceId:null,projectTimeSourceId:null,projectMilestoneSourceId:{not:null},projectMilestoneSource:{is:{AND:[project,milestone].map(right=>right===null?{}:{branchId:{in:right as string[]}})}}});
 return {OR};
}
export const invoiceSourceInclude={projectMilestoneSource:{select:{branchId:true,projectId:true,milestoneId:true}},projectTimeSource:{select:{branchId:true,projectId:true}},order:{select:{branchId:true}},serviceSource:{select:{branchId:true,subscriptionId:true}},customer:{select:{branchId:true}}} as const;
export const invoiceSourceSelect={projectMilestoneSourceId:true,projectTimeSourceId:true,orderId:true,serviceSourceId:true,...invoiceSourceInclude} as const;
type SourceProjection={projectMilestoneSourceId?:string|null;projectMilestoneSource?:{branchId:string|null}|null;projectTimeSourceId?:string|null;projectTimeSource?:{branchId:string|null}|null;tenantId:string;companyId:string;orderId:string|null;serviceSourceId:string|null;order:{branchId:string|null}|null;serviceSource:{branchId:string|null}|null;customer:{branchId:string|null}};
export async function invoiceSourceAllowed(userId:string,invoice:SourceProjection,tx:Prisma.TransactionClient=db){
 const scope={userId,tenantId:invoice.tenantId,companyId:invoice.companyId};
 const noMilestone=invoice.projectMilestoneSourceId==null&&invoice.projectMilestoneSource==null;
 const milestone=invoice.projectMilestoneSourceId!=null&&invoice.projectMilestoneSource!=null&&invoice.projectTimeSourceId==null&&invoice.projectTimeSource==null&&invoice.orderId===null&&invoice.serviceSourceId===null&&invoice.order===null&&invoice.serviceSource===null;
 if(milestone)return (await Promise.all(['project:read','project-milestone:read'].map(permission=>canAccess({...scope,branchId:invoice.projectMilestoneSource!.branchId??undefined,permission},tx)))).every(Boolean)&&await canAccess({...scope,branchId:invoice.customer.branchId??undefined,permission:'customer:read'},tx);
 const project=noMilestone&&invoice.projectTimeSourceId!=null&&invoice.projectTimeSource!=null&&invoice.orderId===null&&invoice.serviceSourceId===null&&invoice.order===null&&invoice.serviceSource===null;
 const order=noMilestone&&invoice.projectTimeSourceId==null&&invoice.projectTimeSource==null&&invoice.orderId!==null&&invoice.serviceSourceId===null&&invoice.order!==null&&invoice.serviceSource===null;
 const service=noMilestone&&invoice.projectTimeSourceId==null&&invoice.projectTimeSource==null&&invoice.orderId===null&&invoice.serviceSourceId!==null&&invoice.order===null&&invoice.serviceSource!==null;
 if(project)return (await Promise.all(['project:read','project-time:read','project-time-invoice:read'].map(permission=>canAccess({...scope,branchId:invoice.projectTimeSource!.branchId??undefined,permission},tx)))).every(Boolean)&&await canAccess({...scope,branchId:invoice.customer.branchId??undefined,permission:'customer:read'},tx);
 if(!order&&!service)return false;
 return (await Promise.all([canAccess({...scope,branchId:invoice.customer.branchId??undefined,permission:'customer:read'},tx),canAccess({...scope,branchId:(order?invoice.order!.branchId:invoice.serviceSource!.branchId)??undefined,permission:order?'order:read':'billing-subscription:read'},tx)])).every(Boolean);
}

/** Registers, print, invoice terms and document posting historically authorize
 * real-order invoices through the invoice's own scope. Do not retroactively
 * require customer/order grants there. New service documents add both scopes. */
export function invoiceDocumentWhere(billing:InvoiceSourceRights,customers:InvoiceSourceRights,project:InvoiceSourceRights=false,time:InvoiceSourceRights=false,timeInvoice:InvoiceSourceRights=false,milestone:InvoiceSourceRights=false):Prisma.InvoiceWhereInput {
 const OR:Prisma.InvoiceWhereInput[]=[{projectMilestoneSourceId:null,orderId:{not:null},serviceSourceId:null,projectTimeSourceId:null,order:{is:{}}}];
 if(billing!==false&&customers!==false)OR.push({projectMilestoneSourceId:null,orderId:null,projectTimeSourceId:null,serviceSourceId:{not:null},serviceSource:{is:billing===null?{}:{branchId:{in:billing}}},customer:customers===null?{}:{branchId:{in:customers}}});
 if(customers!==false&&project!==false&&time!==false&&timeInvoice!==false){const projectWhere=invoiceSourceWhere(false,false,project,time,timeInvoice);OR.push({AND:[projectWhere],customer:customers===null?{}:{branchId:{in:customers}}});}
 if(customers!==false&&project!==false&&milestone!==false)OR.push({AND:[invoiceSourceWhere(false,false,project,false,false,milestone)],customer:customers===null?{}:{branchId:{in:customers}}});
 return {OR};
}
export async function invoiceDocumentSourceAllowed(userId:string,invoice:SourceProjection,tx:Prisma.TransactionClient=db){
 if(invoice.projectMilestoneSourceId==null&&invoice.projectMilestoneSource==null&&invoice.projectTimeSourceId==null&&invoice.projectTimeSource==null&&invoice.orderId!==null&&invoice.serviceSourceId===null&&invoice.order!==null&&invoice.serviceSource===null)return true;
 return invoiceSourceAllowed(userId,invoice,tx);
}
