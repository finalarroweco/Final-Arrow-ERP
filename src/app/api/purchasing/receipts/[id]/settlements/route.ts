import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {dueDate} from "@/lib/date";
import {journalAmount} from "@/lib/ledger";
import {lockDocument} from "@/lib/document-journal";
import {writableLedgerCompany,LedgerPeriodClosed,LedgerCompanyMissing} from "@/lib/ledger-period";
import {settlementReceipt,settlementAllowed,receiptSettlementState,settlementNumber,SettlementConflict} from "@/lib/supplier-settlement";
const uuid=z.string().uuid();
const schema=z.object({tenantId:uuid,requestId:uuid,kind:z.enum(["PAYMENT","REFUND"]),amount:journalAmount,entryDate:dueDate,assetAccountId:uuid,reference:z.string().trim().min(3).max(120)}).strict();
type Context={params:Promise<{id:string}>};
function failure(error:unknown){
 if(error instanceof SettlementConflict)return NextResponse.json({error:error.message},{status:409});
 if(error instanceof LedgerPeriodClosed)return NextResponse.json({error:error.message,lockedThrough:error.lockedThrough},{status:409});
 if(error instanceof LedgerCompanyMissing)return NextResponse.json({error:"Company not found"},{status:404});
 if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004"].includes(error.code))return NextResponse.json({error:"Settlement conflicts with an existing record or source balance"},{status:409});
 throw error;
}
export async function GET(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,params=new URL(request.url).searchParams,parsed=z.object({tenantId:uuid}).strict().safeParse(Object.fromEntries(params));
 if(!uuid.safeParse(id).success||!parsed.success||params.getAll("tenantId").length!==1)return NextResponse.json({error:"Invalid receipt"},{status:400});
 const receipt=await settlementReceipt(db,parsed.data.tenantId,id);if(!receipt)return NextResponse.json({error:"Receipt not found"},{status:404});
 if(!(await settlementAllowed(actor.id,receipt)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const state=await db.$transaction(tx=>receiptSettlementState(tx,receipt),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
  return NextResponse.json({...state,balance:state.balance.toFixed(3),paymentAvailable:state.paymentAvailable.toFixed(3),refundAvailable:state.refundAvailable.toFixed(3),settlementCount:state.settlements.length,settlements:state.settlements.slice(0,50)},{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return failure(error);}
}
export async function POST(request:Request,context:Context){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await context.params,parsed=schema.safeParse(await request.json().catch(()=>null));
 if(!uuid.safeParse(id).success||!parsed.success)return NextResponse.json({error:"Invalid settlement"},{status:400});
 const {tenantId,requestId,kind,entryDate,assetAccountId,reference}=parsed.data,amount=new Prisma.Decimal(parsed.data.amount);
 if(!amount.gt(0))return NextResponse.json({error:"Amount must be positive"},{status:400});
 const receipt=await settlementReceipt(db,tenantId,id);if(!receipt)return NextResponse.json({error:"Receipt not found"},{status:404});
 if(!(await settlementAllowed(actor.id,receipt,true)))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const result=await db.$transaction(async tx=>{
  await lockDocument(tx,"purchase-receipt",tenantId,id);
  const saved=await tx.supplierSettlement.findUnique({where:{id:requestId},include:{entry:{select:{id:true,number:true,entryDate:true,lines:{where:{account:{type:"ASSET"}},select:{accountId:true}}}}}});
  if(saved){if(saved.tenantId!==tenantId||saved.receiptId!==id||saved.kind!==kind||!saved.amount.eq(amount)||saved.reference!==reference||saved.entry.entryDate.toISOString().slice(0,10)!==entryDate||!saved.entry.lines.some(l=>l.accountId===assetAccountId))throw new SettlementConflict("Retry ID belongs to a different settlement");return {settlement:saved,replayed:true};}
  const state=await receiptSettlementState(tx,receipt);
  if(!state.original||state.original.reversed||!state.payable)throw new SettlementConflict("Post an active original receipt journal first");
  if(entryDate<state.latest)throw new SettlementConflict("Settlement date cannot precede the receipt's latest accounting activity");
  if(amount.gt(kind==="PAYMENT"?state.paymentAvailable:state.refundAvailable))throw new SettlementConflict("Amount exceeds available payment or refund balance");
  const company=await writableLedgerCompany(tx,tenantId,receipt.companyId,entryDate);if(company.baseCurrency!==state.original.currency)throw new SettlementConflict("Receipt currency differs from company currency");
  const asset=await tx.ledgerAccount.findFirst({where:{id:assetAccountId,tenantId,companyId:receipt.companyId,type:"ASSET"}});if(!asset)throw new SettlementConflict("Choose a cash/bank asset account in this company");
  const debit=kind==="PAYMENT"?state.payable.id:asset.id,credit=kind==="PAYMENT"?asset.id:state.payable.id,zero=new Prisma.Decimal(0);
  const entry=await tx.journalEntry.create({data:{tenantId,companyId:receipt.companyId,branchId:receipt.branchId,number:settlementNumber(kind,requestId),entryDate:new Date(`${entryDate}T00:00:00Z`),currency:state.original.currency,total:amount,description:`Supplier ${kind.toLowerCase()} ${reference}`,createdBy:actor.id,lines:{create:[{position:0,accountId:debit,debit:amount,credit:zero},{position:1,accountId:credit,debit:zero,credit:amount}]}},select:{id:true,number:true,entryDate:true}});
  const settlement=await tx.supplierSettlement.create({data:{id:requestId,tenantId,companyId:receipt.companyId,branchId:receipt.branchId,receiptId:id,entryId:entry.id,kind,amount,reference,createdBy:actor.id},include:{entry:{select:{id:true,number:true,entryDate:true}}}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"SupplierSettlement",entityId:requestId,action:"supplier-settlement.recorded",metadata:{receiptId:id,journalId:entry.id,kind,amount:amount.toString()}}});
  return {settlement,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});
 }catch(error){return failure(error);}
}
