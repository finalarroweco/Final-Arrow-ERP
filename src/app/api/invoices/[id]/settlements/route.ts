import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {dueDate} from "@/lib/date";
import {journalAmount} from "@/lib/ledger";
import {lockDocument} from "@/lib/document-journal";
import {writableLedgerCompany,LedgerPeriodClosed,LedgerCompanyMissing} from "@/lib/ledger-period";
import {settlementInvoice,customerSettlementAllowed,invoiceSettlementState,customerSettlementNumber,CustomerSettlementConflict} from "@/lib/customer-settlement";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,requestId:uuid,kind:z.enum(["COLLECTION","REFUND"]),amount:journalAmount,entryDate:dueDate,assetAccountId:uuid,reference:z.string().trim().min(3).max(120)}).strict();
type Context={params:Promise<{id:string}>};
function failure(error:unknown){
 if(error instanceof CustomerSettlementConflict)return NextResponse.json({error:error.message},{status:409});
 if(error instanceof LedgerPeriodClosed)return NextResponse.json({error:error.message,lockedThrough:error.lockedThrough},{status:409});
 if(error instanceof LedgerCompanyMissing)return NextResponse.json({error:"Company not found"},{status:404});
 if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004"].includes(error.code))return NextResponse.json({error:"Settlement conflicts with an existing record or source balance"},{status:409});
 throw error;
}
export async function GET(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,params=new URL(request.url).searchParams,parsed=z.object({tenantId:uuid}).strict().safeParse(Object.fromEntries(params));
 if(!uuid.safeParse(id).success||!parsed.success||params.getAll("tenantId").length!==1)return NextResponse.json({error:"Invalid invoice"},{status:400});
 const invoice=await settlementInvoice(db,parsed.data.tenantId,id);if(!invoice)return NextResponse.json({error:"Invoice not found"},{status:404});
 if(!(await customerSettlementAllowed(actor.id,invoice)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const state=await db.$transaction(tx=>invoiceSettlementState(tx,invoice),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
  return NextResponse.json({...state,balance:state.balance.toFixed(3),collected:state.collected.toFixed(3),paymentAvailable:state.paymentAvailable.toFixed(3),refundAvailable:state.refundAvailable.toFixed(3),settlementCount:state.settlements.length,settlements:state.settlements.slice(0,50)},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid settlement"},{status:400});
 const {tenantId,requestId,kind,entryDate,assetAccountId,reference}=parsed.data,amount=new Prisma.Decimal(parsed.data.amount);
 if(!amount.gt(0))return NextResponse.json({error:"Amount must be positive"},{status:400});
 const invoice=await settlementInvoice(db,tenantId,id);if(!invoice)return NextResponse.json({error:"Invoice not found"},{status:404});
 if(!(await customerSettlementAllowed(actor.id,invoice,true)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const result=await db.$transaction(async tx=>{
  await lockDocument(tx,"invoice",tenantId,id);
  const saved=await tx.customerSettlement.findUnique({where:{id:requestId},include:{entry:{select:{id:true,number:true,entryDate:true,lines:{where:kind==="COLLECTION"?{position:0}:{position:1},select:{accountId:true}}}}}});
  if(saved){if(saved.tenantId!==tenantId||saved.invoiceId!==id||saved.kind!==kind||!saved.amount.eq(amount)||saved.reference!==reference||saved.entry.entryDate.toISOString().slice(0,10)!==entryDate||!saved.entry.lines.some(l=>l.accountId===assetAccountId))throw new CustomerSettlementConflict("Retry ID belongs to a different settlement");return {settlement:saved,replayed:true};}
  const state=await invoiceSettlementState(tx,invoice);
  if(invoice.status!=="ISSUED"||!state.original||state.original.reversed||!state.receivable)throw new CustomerSettlementConflict("Post an active original invoice journal first");
  if(entryDate<state.latest)throw new CustomerSettlementConflict("Settlement date cannot precede the invoice's latest accounting activity");
  if(amount.gt(kind==="COLLECTION"?state.paymentAvailable:state.refundAvailable))throw new CustomerSettlementConflict("Amount exceeds available payment or refund balance");
  const company=await writableLedgerCompany(tx,tenantId,invoice.companyId,entryDate);if(company.baseCurrency!==state.original.currency)throw new CustomerSettlementConflict("Invoice currency differs from company currency");
  const asset=await tx.ledgerAccount.findFirst({where:{id:assetAccountId,tenantId,companyId:invoice.companyId,type:"ASSET"}});if(!asset)throw new CustomerSettlementConflict("Choose a cash/bank asset account in this company");
  if(asset.id===state.receivable.id)throw new CustomerSettlementConflict("Cash/bank account must differ from the invoice receivable");
  const debit=kind==="COLLECTION"?asset.id:state.receivable.id,credit=kind==="COLLECTION"?state.receivable.id:asset.id,zero=new Prisma.Decimal(0);
  const entry=await tx.journalEntry.create({data:{tenantId,companyId:invoice.companyId,branchId:invoice.branchId,number:customerSettlementNumber(kind,requestId),entryDate:new Date(`${entryDate}T00:00:00Z`),currency:state.original.currency,total:amount,description:`Customer ${kind.toLowerCase()} ${reference}`,createdBy:actor.id,lines:{create:[{position:0,accountId:debit,debit:amount,credit:zero},{position:1,accountId:credit,debit:zero,credit:amount}]}},select:{id:true,number:true,entryDate:true}});
  const settlement=await tx.customerSettlement.create({data:{id:requestId,tenantId,companyId:invoice.companyId,branchId:invoice.branchId,invoiceId:id,entryId:entry.id,kind,amount,reference,createdBy:actor.id},include:{entry:{select:{id:true,number:true,entryDate:true}}}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"CustomerSettlement",entityId:requestId,action:"customer-settlement.recorded",metadata:{invoiceId:id,journalId:entry.id,kind,amount:amount.toString()}}});
  return {settlement,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});
 }catch(error){return failure(error);}
}
