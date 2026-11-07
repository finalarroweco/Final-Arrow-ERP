import {drawerConflictMessage} from "@/lib/pos-drawer-conflict";
import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {posScope} from "@/lib/pos";
import {posShiftAction as schema} from "@/lib/pos-shift";
import {queryInput} from "@/lib/ledger";
const uuid=z.string().uuid();
class ShiftConflict extends Error{}
const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const p=posScope.extend({page:z.coerce.number().int().min(0).max(100000).default(0),shiftId:uuid.optional(),format:z.enum(["json","csv"]).default("json")}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","page","shiftId","format"]));if(!p.success)return NextResponse.json({error:"Invalid shift filters"},{status:400});const {tenantId,companyId,branchId,page,shiftId,format}=p.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 return db.$transaction(async tx=>{
 const shifts=await tx.posShift.findMany({where:{tenantId,companyId,branchId,...(shiftId?{id:shiftId}:{})},orderBy:[{openedAt:"desc"},{id:"asc"}],skip:shiftId?0:page*50,take:51});
 if(shiftId&&!shifts.length)return NextResponse.json({error:"Shift not found"},{status:404});
 if(format==="csv"){
  if(!shiftId)return NextResponse.json({error:"Select a shift for CSV"},{status:400});
  const s=shifts[0],events=await tx.posShiftEvent.findMany({where:{shiftId},orderBy:[{createdAt:"asc"},{id:"asc"}],take:5001,include:{order:{select:{tendered:true,change:true}}}});if(events.length>5000)return NextResponse.json({error:"Shift event limit exceeded"},{status:413});
  const expected=s.expectedCash??events.reduce((n,e)=>n.plus(e.cashDelta),s.openingCash);
  const rows=[["Shift","Currency","Opened UTC","Closed UTC","Opening cash","Expected cash","Counted cash","Difference","Closure reason"],[s.number,s.currency,s.openedAt.toISOString(),s.closedAt?.toISOString()??"",s.openingCash.toFixed(3),expected.toFixed(3),s.countedCash?.toFixed(3)??"",s.difference?.toFixed(3)??"",s.closeReason??""],[],["Recorded UTC","Kind","Reference","Reason","Gross amount","Cash delta","Tendered","Change","Order","Refund","Actor"],...events.map(e=>[e.createdAt.toISOString(),e.kind,e.reference,e.reason,e.amount.toFixed(3),e.cashDelta.toFixed(3),e.order?.tendered?.toFixed(3)??"",e.order?.change?.toFixed(3)??"",e.orderId??"",e.refundId??"",e.createdBy??""])];
  return new Response("\uFEFF"+rows.map(r=>r.map(cell).join(",")).join("\r\n")+"\r\n",{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="shift-'+s.number+'.csv"',"Cache-Control":"private, no-store"}});
 }
 const groups=await tx.posShiftEvent.groupBy({by:["shiftId","kind"],where:{shiftId:{in:shifts.map(s=>s.id)}},_sum:{amount:true,cashDelta:true},_count:{_all:true}});
 const result=shifts.slice(0,50).map(s=>{const g=groups.filter(g=>g.shiftId===s.id),sum=(kind:string,field:"amount"|"cashDelta")=>g.find(g=>g.kind===kind)?._sum[field]??new Prisma.Decimal(0),cashSales=sum("PAYMENT","cashDelta"),cashRefunds=sum("REFUND","cashDelta").negated(),expected=s.expectedCash??g.reduce((n,g)=>n.plus(g._sum.cashDelta??0),s.openingCash);return{...s,openingCash:s.openingCash.toFixed(3),countedCash:s.countedCash?.toFixed(3)??null,difference:s.difference?.toFixed(3)??null,expectedCash:expected.toFixed(3),eventCount:g.reduce((n,g)=>n+g._count._all,0),cashSales:cashSales.toFixed(3),cardSales:sum("PAYMENT","amount").minus(cashSales).toFixed(3),cashRefunds:cashRefunds.toFixed(3),cardRefunds:sum("REFUND","amount").minus(cashRefunds).toFixed(3),cashIn:sum("IN","amount").toFixed(3),cashOut:sum("OUT","amount").toFixed(3)};});
 const active=await tx.posShift.findFirst({where:{tenantId,companyId,branchId,closedAt:null},select:{id:true}});
 return NextResponse.json({shifts:result,activeId:active?.id??null,nextPage:shifts.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const p=schema.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid shift action"},{status:400});const {tenantId,companyId,branchId}=p.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:manage"})))return NextResponse.json({error:"Forbidden"},{status:403});
 try{const result=await db.$transaction(async tx=>{
 const companies=await tx.$queryRaw<{baseCurrency:string}[]>`SELECT "baseCurrency" FROM "Company" WHERE id=${companyId}::uuid AND "tenantId"=${tenantId}::uuid FOR SHARE`;
 const branches=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "Branch" WHERE id=${branchId}::uuid AND "tenantId"=${tenantId}::uuid AND "companyId"=${companyId}::uuid FOR UPDATE`;if(!companies.length||!branches.length)throw new ShiftConflict("Branch not found");
 const input=p.data;
 if(input.action==="open"){
  const amount=new Prisma.Decimal(input.openingCash),saved=await tx.posShift.findUnique({where:{id:input.requestId}});
  if(saved){if(saved.tenantId!==tenantId||saved.companyId!==companyId||saved.branchId!==branchId||saved.number!==input.number||!saved.openingCash.eq(amount))throw new ShiftConflict("Retry ID belongs to another shift");return{shift:saved,replayed:true};}
  if(await tx.posShift.findFirst({where:{branchId,closedAt:null}}))throw new ShiftConflict("This branch already has an open shift");
  const shift=await tx.posShift.create({data:{id:input.requestId,tenantId,companyId,branchId,number:input.number,openingCash:amount,currency:companies[0].baseCurrency,openedBy:actor.id}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"PosShift",entityId:shift.id,action:"pos-shift.opened",metadata:{branchId,openingCash:amount.toFixed(3)}}});return{shift,replayed:false};
 }
 const shift=await tx.posShift.findFirst({where:{id:input.shiftId,tenantId,companyId,branchId}});if(!shift)throw new ShiftConflict("Shift not found");
 if(input.action==="move"){
  const amount=new Prisma.Decimal(input.amount);if(!amount.gt(0))throw new ShiftConflict("Cash movement must be positive");const saved=await tx.posShiftEvent.findUnique({where:{id:input.requestId}});
  if(saved){if(saved.shiftId!==shift.id||saved.kind!==input.kind||!saved.amount.eq(amount)||saved.reference!==input.reference||saved.reason!==input.reason)throw new ShiftConflict("Retry ID belongs to another cash movement");return{event:saved,replayed:true};}
  if(shift.closedAt)throw new ShiftConflict("Shift is closed");
  const recorded=await tx.posShiftEvent.aggregate({where:{shiftId:shift.id},_sum:{cashDelta:true},_count:{_all:true}});if(recorded._count._all>=5000)throw new ShiftConflict("Close this full shift and open another");if(input.kind==="OUT"&&amount.gt(shift.openingCash.plus(recorded._sum.cashDelta??0)))throw new ShiftConflict("Insufficient drawer cash for this recorded movement");
  const event=await tx.posShiftEvent.create({data:{id:input.requestId,shiftId:shift.id,kind:input.kind,amount,cashDelta:input.kind==="IN"?amount:amount.negated(),reference:input.reference,reason:input.reason,createdBy:actor.id}});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"PosShiftEvent",entityId:event.id,action:"pos-shift.cash-recorded",metadata:{shiftId:shift.id,kind:input.kind,amount:amount.toFixed(3)}}});return{event,replayed:false};
 }
 const counted=new Prisma.Decimal(input.countedCash);
 if(shift.closedAt){if(!shift.countedCash?.eq(counted)||shift.closeReason!==input.reason)throw new ShiftConflict("Shift already closed with a different count");return{shift,replayed:true};}
 const sums=await tx.posShiftEvent.aggregate({where:{shiftId:shift.id},_sum:{cashDelta:true}}),expected=shift.openingCash.plus(sums._sum.cashDelta??0),difference=counted.minus(expected);
 if(!difference.eq(0)&&input.reason.length<3)throw new ShiftConflict("Explain the counted cash difference before closing");
 const closed=await tx.posShift.update({where:{id:shift.id},data:{closedAt:new Date(),closedBy:actor.id,countedCash:counted,expectedCash:expected,difference,closeReason:input.reason}});
 await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"PosShift",entityId:shift.id,action:"pos-shift.closed",metadata:{expectedCash:expected.toFixed(3),countedCash:counted.toFixed(3),difference:difference.toFixed(3)}}});return{shift:closed,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}
 catch(error){const drawer=drawerConflictMessage(error);if(drawer)return NextResponse.json({error:drawer},{status:409});if(error instanceof ShiftConflict)return NextResponse.json({error:error.message},{status:409});if(error instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2004"].includes(error.code))return NextResponse.json({error:"Check the open shift, available cash, movement limit and duplicate records"},{status:409});throw error;}
}
