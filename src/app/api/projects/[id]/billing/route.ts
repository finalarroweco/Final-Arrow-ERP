import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {billingProject,billingInvoiceWhere,projectBillingReport} from "@/lib/project-billing";
import {projectBillingInput,billingCsv} from "@/lib/project-billing-input";
import {OperationalError,operationalFailure} from "@/lib/operational-records";
import {invoiceGross} from "@/lib/invoice-vat";
import {settlementInvoice,customerSettlementAllowed} from "@/lib/customer-settlement";
const uuid=z.string().uuid(),filters=z.object({tenantId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),state:z.enum(["LINKED","UNLINKED","ALL"]).default("LINKED"),q:z.string().trim().max(120).default(""),mode:z.enum(["report","candidates"]).default("report"),format:z.enum(["json","csv"]).default("json")}).strict();
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,q=new URL(request.url).searchParams,p=filters.safeParse(Object.fromEntries(q));if(!uuid.safeParse(id).success||!p.success||[...q.keys()].some(k=>q.getAll(k).length!==1))return NextResponse.json({error:"Invalid project billing filters"},{status:400});
 try{const {tenantId,page,state,format,mode,q:search}=p.data;
 if(mode==="candidates"){if(format!=="json")throw new OperationalError("Candidate format is JSON only",400);const project=await billingProject(actor.id,tenantId,id),where=await billingInvoiceWhere(actor.id,project),rows=await db.invoice.findMany({where:{...where,status:"ISSUED",projectLinks:{none:{unlinkedAt:null}},...(search?{number:{contains:search,mode:"insensitive"}}:{})},select:{id:true,number:true,currency:true,subtotal:true,vat:{select:{taxAmount:true}}},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});return NextResponse.json({candidates:rows.slice(0,50).map(i=>({id:i.id,number:i.number,currency:i.currency,gross:invoiceGross(i).toFixed(3)})),page,nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}
 const r=await projectBillingReport(actor.id,tenantId,id,page,state,search);if(format==="csv")return new Response("\uFEFF"+billingCsv({tenantId,companyId:r.project.companyId,projectId:id,projectCode:r.project.code,state,q:search},r.allRows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=project-billing.csv","Cache-Control":"private, no-store"}});const {allRows,...report}=r;void allRows;return NextResponse.json(report,{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,p=projectBillingInput.safeParse(await request.json().catch(()=>null));if(!uuid.safeParse(id).success||!p.success)return NextResponse.json({error:"Invalid project invoice change"},{status:400});
 try{const input=p.data,{tenantId}=input,project=await billingProject(actor.id,tenantId,id,true);let invoiceId:string;
 if(input.action==="LINK")invoiceId=input.invoiceId;else{const link=await db.projectInvoiceLink.findFirst({where:{id:input.linkId,tenantId,projectId:id},select:{invoiceId:true}});if(!link)throw new OperationalError("Invoice link not found",404);invoiceId=link.invoiceId;}
 const invoice=await settlementInvoice(db,tenantId,invoiceId);if(!invoice)throw new OperationalError("Invoice not found",404);if(invoice.companyId!==project.companyId||(project.branchId&&invoice.branchId!==project.branchId))throw new OperationalError("Invoice is outside the project company or branch");if(!(await customerSettlementAllowed(actor.id,invoice)))throw new OperationalError("Forbidden invoice source",403);
 const link=await db.$transaction(async tx=>{
 const [parent]=await tx.$queryRaw<{status:string}[]>`SELECT status FROM "Project" WHERE id=${id}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${invoiceId}::uuid AND "tenantId"=${tenantId}::uuid FOR UPDATE`;
 if(input.action==="LINK"){
  const saved=await tx.projectInvoiceLink.findUnique({where:{id:input.requestId}});if(saved){if(saved.tenantId!==tenantId||saved.projectId!==project.id||saved.invoiceId!==invoiceId||saved.createdBy!==actor.id||saved.note!==input.note)throw new OperationalError("Request ID already used for different invoice link");return saved;}
  if(!parent||!["PLANNED","ACTIVE","ON_HOLD"].includes(parent.status))throw new OperationalError("Project is closed");
  const current=await tx.invoice.findUniqueOrThrow({where:{id:invoiceId},select:{status:true}});if(current.status!=="ISSUED")throw new OperationalError("Only issued invoices can be linked");if(await tx.projectInvoiceLink.findFirst({where:{invoiceId,unlinkedAt:null}}))throw new OperationalError("Invoice already linked. Unlink it from its original project first.");if(await tx.projectInvoiceLink.count({where:{tenantId,projectId:id}})>=1000)throw new OperationalError("Project invoice history limit reached");
  const created=await tx.projectInvoiceLink.create({data:{id:input.requestId,tenantId,companyId:project.companyId,projectId:id,invoiceId,note:input.note,createdBy:actor.id}});await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"ProjectInvoiceLink",entityId:created.id,action:"project-invoice.linked",metadata:{parentId:project.id,requestId:created.id,transaction:created.creationTransaction}}});return created;
 }
 const saved=await tx.projectInvoiceLink.findUniqueOrThrow({where:{id:input.linkId}});if(saved.unlinkedAt){if(saved.unlinkRequestId!==input.requestId||saved.unlinkedBy!==actor.id||saved.unlinkReason!==input.reason)throw new OperationalError("Invoice link was already removed by another request");return saved;}
 if(!parent||!["PLANNED","ACTIVE","ON_HOLD"].includes(parent.status))throw new OperationalError("Project is closed");
 const updated=await tx.projectInvoiceLink.update({where:{id:saved.id},data:{unlinkRequestId:input.requestId,unlinkedBy:actor.id,unlinkReason:input.reason}});await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"ProjectInvoiceLink",entityId:saved.id,action:"project-invoice.unlinked",metadata:{parentId:project.id,requestId:updated.unlinkRequestId,transaction:updated.unlinkTransaction}}});return updated;
 },{timeout:15000,maxWait:10000});return NextResponse.json({link},{status:201,headers:{"Cache-Control":"private, no-store"}});
 }catch(e){const f=operationalFailure(e);return NextResponse.json({error:f.error},{status:f.status});}
}
