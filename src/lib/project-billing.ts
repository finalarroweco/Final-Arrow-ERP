import {Prisma} from "@prisma/client";
import {db} from "./db";
import {canAccess,readableCompanyPermissions} from "./access";
import {OperationalError} from "./operational-records";
import {documentJournalNumber} from "./document-journal";
import {invoiceGross} from "./invoice-vat";
import {billingSummary,type BillingRow} from "./project-billing-input";
export async function billingProject(userId:string,tenantId:string,id:string,write=false){const project=await db.project.findUnique({where:{tenantId_id:{tenantId,id}},select:{id:true,tenantId:true,companyId:true,branchId:true,name:true,code:true,status:true}});if(!project)throw new OperationalError("Project not found",404);for(const permission of ["project:read","project-billing:read",...(write?["project-billing:manage"]:[])])if(!(await canAccess({userId,tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission})))throw new OperationalError("Forbidden",403);return project;}
export async function billingInvoiceWhere(userId:string,project:Awaited<ReturnType<typeof billingProject>>):Promise<Prisma.InvoiceWhereInput>{const rights=await readableCompanyPermissions({userId,tenantId:project.tenantId,companyId:project.companyId,permissions:["invoice:read","order:read","customer:read","ledger:read"]});if(Object.values(rights).some(r=>r===false))throw new OperationalError("Invoice, order, customer and ledger read permissions are required",403);
 const invoice=rights["invoice:read"],ledger=rights["ledger:read"],order=rights["order:read"],customer=rights["customer:read"];
 const branches=invoice===null?ledger:ledger===null?invoice:(invoice as string[]).filter(id=>(ledger as string[]).includes(id));
 return {tenantId:project.tenantId,companyId:project.companyId,AND:[...(project.branchId?[{branchId:project.branchId}]:[]),...(branches===null?[]:[{branchId:{in:branches as string[]}}])],order:order===null?{}:{branchId:{in:order as string[]}},customer:customer===null?{}:{branchId:{in:customer as string[]}}};
}
export async function projectBillingReport(userId:string,tenantId:string,id:string,page=0,state="LINKED",q=""){
 const project=await billingProject(userId,tenantId,id),invoiceWhere=await billingInvoiceWhere(userId,project);
 return db.$transaction(async tx=>{
 const links=await tx.projectInvoiceLink.findMany({where:{tenantId,projectId:id,invoice:{...invoiceWhere,...(q?{number:{contains:q,mode:"insensitive"}}:{})},...(state==="LINKED"?{unlinkedAt:null}:state==="UNLINKED"?{unlinkedAt:{not:null}}:{})},select:{id:true,invoiceId:true,note:true,createdAt:true,unlinkedAt:true,unlinkReason:true,invoice:{select:{id:true,number:true,branchId:true,currency:true,status:true,subtotal:true,vat:{select:{taxAmount:true}}}}},orderBy:[{createdAt:"desc"},{id:"asc"}],take:1001});
 if(links.length>1000)throw new OperationalError("Project invoice history exceeds 1000 records",413);
 const invoices=[...new Map(links.map(l=>[l.invoiceId,l.invoice])).values()],ids=invoices.map(i=>i.id),numbers=invoices.map(i=>documentJournalNumber("invoice",i.id));
 const entries=numbers.length?await tx.journalEntry.findMany({where:{tenantId,companyId:project.companyId,number:{in:numbers}},select:{id:true,number:true,total:true,currency:true,branchId:true,reversal:{select:{id:true}}}}):[];
 const settlements=ids.length?await tx.customerSettlement.findMany({where:{tenantId,invoiceId:{in:ids}},select:{invoiceId:true,kind:true,amount:true,entry:{select:{currency:true,reversal:{select:{id:true}}}}},take:20001}):[];
 if(settlements.length>20000)throw new OperationalError("Billing exceeds 20000 settlements. Narrow the invoice search.",413);
 const entryMap=new Map(entries.map(e=>[e.number,e])),settlementMap=new Map<string,typeof settlements>();for(const s of settlements){const group=settlementMap.get(s.invoiceId)??[];group.push(s);settlementMap.set(s.invoiceId,group);}
 const financial=new Map<string,{gross:string;posted:string;collected:string;balance:string}>();
 for(const invoice of invoices){const gross=invoiceGross(invoice),entry=entryMap.get(documentJournalNumber("invoice",invoice.id));if(entry&&(!entry.total.eq(gross)||entry.currency!==invoice.currency||entry.branchId!==invoice.branchId))throw new OperationalError("Invoice source journal cannot be reconciled");const active=entry&&!entry.reversal&&invoice.status==="ISSUED",amounts=(settlementMap.get(invoice.id)??[]).filter(s=>!s.entry.reversal);if(amounts.some(s=>s.entry.currency!==invoice.currency))throw new OperationalError("Settlement currency cannot be reconciled");const collected=amounts.reduce((sum,s)=>s.kind==="COLLECTION"?sum.plus(s.amount):sum.minus(s.amount),new Prisma.Decimal(0));if(!active&&!collected.eq(0))throw new OperationalError("Invoice settlements require an active original posting");const posted=active?gross:new Prisma.Decimal(0);financial.set(invoice.id,{gross:gross.toFixed(3),posted:posted.toFixed(3),collected:collected.toFixed(3),balance:posted.minus(collected).toFixed(3)});}
 const allRows:BillingRow[]=links.map(l=>({id:l.id,invoiceId:l.invoiceId,number:l.invoice.number,invoiceStatus:l.invoice.status,currency:l.invoice.currency,...financial.get(l.invoiceId)!,note:l.note,createdAt:l.createdAt.toISOString(),unlinkedAt:l.unlinkedAt?.toISOString()??null,unlinkReason:l.unlinkReason}));
 return {project,summary:billingSummary(allRows),rows:allRows.slice(page*50,page*50+50),allRows,state,q,page,nextPage:allRows.length>(page+1)*50?page+1:null};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
