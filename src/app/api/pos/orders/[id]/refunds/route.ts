import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {dueDate} from "@/lib/date";
import {lockDocument} from "@/lib/document-journal";
import {writableLedgerCompany,LedgerPeriodClosed,LedgerCompanyMissing} from "@/lib/ledger-period";
import {posRefundOrder,posRefundAllowed,posRefundState,posRefundNumber,PosRefundConflict} from "@/lib/pos-refund";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,requestId:uuid,entryDate:dueDate,reference:z.string().trim().min(3).max(120),reason:z.string().trim().min(3).max(500)}).strict();
type Context={params:Promise<{id:string}>};
function failure(error:unknown){
 if(error instanceof PosRefundConflict||error instanceof LedgerPeriodClosed)return NextResponse.json({error:error.message},{status:409});
 if(error instanceof LedgerCompanyMissing)return NextResponse.json({error:"Company not found"},{status:404});
 if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004"].includes(error.code))return NextResponse.json({error:"Refund conflicts with source history; reload the records"},{status:409});
 throw error;
}
export async function GET(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,params=new URL(request.url).searchParams,parsed=z.object({tenantId:uuid}).strict().safeParse(Object.fromEntries(params));
 if(!uuid.safeParse(id).success||!parsed.success||params.getAll("tenantId").length!==1)return NextResponse.json({error:"Invalid order"},{status:400});
 const order=await posRefundOrder(db,parsed.data.tenantId,id);if(!order)return NextResponse.json({error:"Order not found"},{status:404});
 if(!(await posRefundAllowed(actor.id,order)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const state=await db.$transaction(tx=>posRefundState(tx,order),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});return NextResponse.json({eligible:state.eligible,latest:state.latest,amount:order.total.toFixed(3),netAmount:state.net.toFixed(3),taxAmount:state.tax.toFixed(3),currency:order.currency,original:state.original?{id:state.original.id,number:state.original.number,reversed:!!state.original.reversal}:null,activeId:state.active?.id??null,count:state.refunds.length,refunds:state.refunds.slice(0,50)},{headers:{"Cache-Control":"private, no-store"}});}catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,parsed=schema.safeParse(await request.json().catch(()=>null));if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid full refund"},{status:400});
 const {tenantId,requestId,entryDate,reference,reason}=parsed.data,order=await posRefundOrder(db,tenantId,id);if(!order)return NextResponse.json({error:"Order not found"},{status:404});
 if(!(await posRefundAllowed(actor.id,order,true)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const result=await db.$transaction(async tx=>{
  await lockDocument(tx,"pos",tenantId,id);
  const saved=await tx.posRefund.findUnique({where:{id:requestId},include:{entry:{select:{id:true,number:true,entryDate:true}}}});
  if(saved){if(saved.tenantId!==tenantId||saved.orderId!==id||saved.reference!==reference||saved.reason!==reason||saved.entry.entryDate.toISOString().slice(0,10)!==entryDate)throw new PosRefundConflict("Retry ID belongs to a different refund");return{refund:saved,replayed:true};}
  const source=await posRefundOrder(tx,tenantId,id);if(!source)throw new PosRefundConflict("Order changed");const state=await posRefundState(tx,source);
  if(!state.eligible||!state.original)throw new PosRefundConflict("Post an active original paid-order journal and reverse any existing refund first");
  if(state.refunds.length>=5000)throw new PosRefundConflict("Order reached the 5000 refund record limit");
  if(entryDate<state.latest)throw new PosRefundConflict("Refund cannot precede the latest order accounting activity");
  const company=await writableLedgerCompany(tx,tenantId,source.companyId,entryDate);if(company.baseCurrency!==source.currency)throw new PosRefundConflict("Company currency differs from the saved order");
  const entry=await tx.journalEntry.create({data:{tenantId,companyId:source.companyId,branchId:source.branchId,number:posRefundNumber(requestId),entryDate:new Date(`${entryDate}T00:00:00Z`),currency:source.currency,total:source.total,description:`POS full refund ${source.number} ${reference}`,createdBy:actor.id,lines:{create:state.original.lines.map(l=>({position:l.position,accountId:l.accountId,debit:l.credit,credit:l.debit}))}},select:{id:true,number:true,entryDate:true}});
  const refund=await tx.posRefund.create({data:{id:requestId,tenantId,companyId:source.companyId,orderId:id,entryId:entry.id,originalEntryId:state.original.id,amount:source.total,netAmount:state.net,taxAmount:state.tax,reference,reason,createdBy:actor.id},include:{entry:{select:{id:true,number:true,entryDate:true}}}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"PosRefund",entityId:requestId,action:"pos-refund.recorded",metadata:{orderId:id,journalId:entry.id,originalEntryId:state.original.id,amount:source.total.toFixed(3)}}});return{refund,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(error){return failure(error);}
}
