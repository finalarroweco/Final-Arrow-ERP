import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {readStockTransfer} from "@/lib/stock-transfers";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await params,query=new URL(request.url).searchParams;
 const p=z.object({tenantId:z.string().uuid().transform(v=>v.toLowerCase())}).strict().safeParse(Object.fromEntries(query));
 if(!p.success||!z.string().uuid().safeParse(id).success||query.getAll("tenantId").length!==1)return NextResponse.json({error:"Invalid transfer scope"},{status:400});
 const transfer=await readStockTransfer(actor.id,id,p.data.tenantId);
 return NextResponse.json(transfer?{transfer}:{error:"Transfer not found"},{status:transfer?200:404,headers:{"Cache-Control":"private, no-store"}});
}
