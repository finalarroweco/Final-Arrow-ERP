import {NextResponse} from "next/server";
import {z} from "zod";
import {bankFailure} from "@/lib/bank-response";
import {randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,bankScope,bankStatementInput,normalizedStatement,lockBankAccount,BankError} from "@/lib/bank-reconciliation";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const q=new URL(request.url).searchParams;
 const parsed=bankScope.extend({page:z.coerce.number().int().min(0).max(10000).default(0)}).strict().safeParse(Object.fromEntries(q));if(!parsed.success||[...q.keys()].some(k=>q.getAll(k).length!==1))return NextResponse.json({error:"Invalid scope"},{status:400});
 const {tenantId,companyId,page}=parsed.data;if(!(await bankAllowed(actor.id,tenantId,companyId)))return NextResponse.json({error:"Company-wide ledger read permission required"},{status:403});
 const rows=await db.bankStatement.findMany({where:{tenantId,companyId},include:{account:{select:{code:true,name:true}},_count:{select:{lines:true}}},orderBy:[{to:"desc"},{id:"asc"}],skip:page*50,take:51});return NextResponse.json({statements:rows.slice(0,50),nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const parsed=bankStatementInput.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid statement (maximum 500 movements, 366 days)"},{status:400});
 const {tenantId,companyId}=parsed.data;if(!(await bankAllowed(actor.id,tenantId,companyId,true)))return NextResponse.json({error:"Company-wide ledger read/post permission required"},{status:403});
 try{const data=normalizedStatement(parsed.data);const result=await db.$transaction(async tx=>{
  await lockBankAccount(tx,tenantId,companyId,data.accountId);
  const saved=await tx.bankStatement.findUnique({where:{id:data.requestId},select:{id:true,tenantId:true,companyId:true,requestHash:true}});
  if(saved){if(saved.tenantId!==tenantId||saved.companyId!==companyId||saved.requestHash!==data.requestHash)throw new BankError("Request ID belongs to another statement");return {id:saved.id,replayed:true};}
  const company=await tx.company.findUnique({where:{tenantId_id:{tenantId,id:companyId}},select:{baseCurrency:true}});if(!company)throw new BankError("Company not found",404);
  if(await tx.bankStatement.findFirst({where:{accountId:data.accountId,voidedAt:null,from:{lte:new Date(data.to)},to:{gte:new Date(data.from)}}}))throw new BankError("Statement period overlaps a saved statement");
  const statement=await tx.bankStatement.create({data:{id:data.requestId,tenantId,companyId,accountId:data.accountId,reference:data.reference,from:new Date(data.from),to:new Date(data.to),opening:data.opening,closing:data.closing,currency:company.baseCurrency,requestHash:data.requestHash,createdBy:actor.id},select:{id:true}});
  if(data.lines.length)await tx.bankStatementLine.createMany({data:data.lines.map((l,position)=>({id:randomUUID(),tenantId,companyId,accountId:data.accountId,statementId:statement.id,position,bookingDate:new Date(l.bookingDate),reference:l.reference,amount:l.amount}))});
  await tx.auditLog.create({data:{tenantId,actorId:actor.id,entity:"BankStatement",entityId:statement.id,action:"bank-statement.imported",metadata:{accountId:data.accountId,reference:data.reference,movements:data.lines.length,from:data.from,to:data.to}}});return {id:statement.id,replayed:false};
 },{timeout:15000,maxWait:10000});return NextResponse.json(result,{status:201});}catch(e){return bankFailure(e);}
}
