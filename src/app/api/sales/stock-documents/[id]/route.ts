import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {readSalesStockDocument} from "@/lib/sales-stock";
import {salesStockFailure,salesStockHeaders as headers} from "@/lib/sales-stock-route";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401,headers});
 const id=z.string().uuid().transform(v=>v.toLowerCase()).safeParse((await params).id),query=new URL(request.url).searchParams;
 const scope=z.object({expectedActorId:z.string().uuid().transform(v=>v.toLowerCase()).optional(),tenantId:z.string().uuid().transform(v=>v.toLowerCase())}).strict().safeParse(Object.fromEntries(query));
 if(!id.success||!scope.success||[...query.keys()].some(k=>query.getAll(k).length!==1))return NextResponse.json({error:'Invalid stock document scope'},{status:400,headers});
 if(scope.data.expectedActorId&&scope.data.expectedActorId!==actor.id)return NextResponse.json({error:"Signed-in user changed. Reload this workspace."},{status:403,headers:{"Cache-Control":"private, no-store"}});
 try{const result=await readSalesStockDocument(actor.id,id.data,scope.data.tenantId);return NextResponse.json(result?{actorId:actor.id,...result}:{error:'Stock document not found'},{status:result?200:404,headers});}catch(e){return salesStockFailure(e);}
}
