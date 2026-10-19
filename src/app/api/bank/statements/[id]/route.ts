import {NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed,reconciliation} from "@/lib/bank-reconciliation";
import {bankFailure} from "@/lib/bank-response";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});const {id}=await params,q=new URL(request.url).searchParams,tenantId=q.get("tenantId");if(!z.string().uuid().safeParse(id).success||!z.string().uuid().safeParse(tenantId).success||q.size!==1)return NextResponse.json({error:"Invalid statement"},{status:400});
 const s=await db.bankStatement.findFirst({where:{id,tenantId:tenantId!},select:{companyId:true}});if(!s)return NextResponse.json({error:"Statement not found"},{status:404});if(!(await bankAllowed(actor.id,tenantId!,s.companyId)))return NextResponse.json({error:"Company-wide ledger read permission required"},{status:403});
 try{return NextResponse.json(await db.$transaction(tx=>reconciliation(tx,id,tenantId!),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000}),{headers:{"Cache-Control":"private, no-store"}});}catch(e){return bankFailure(e);}
}
