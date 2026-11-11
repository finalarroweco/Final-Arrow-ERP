import {NextResponse} from "next/server";
import {Prisma} from "@prisma/client";
import {currentUser} from "@/lib/auth";
import {stockTransferRequest} from "@/lib/stock-transfer-input";
import {cancelStockTransferRequest,StockTransferError} from "@/lib/stock-transfers";
export async function POST(request:Request){
 const headers={"Cache-Control":"private, no-store"},actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401,headers});
 const p=stockTransferRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid transfer cancellation request"},{status:400,headers});
 if(p.data.expectedActorId!==actor.id)return NextResponse.json({error:"This saved request belongs to a different signed-in user"},{status:403,headers});
 try{return NextResponse.json(await cancelStockTransferRequest(actor.id,p.data),{headers});}catch(e){if(e instanceof StockTransferError)return NextResponse.json({error:e.message},{status:e.status,headers});if(e instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004","P2010","P2034"].includes(e.code))return NextResponse.json({error:"Cancellation was not confirmed. Keep the request and retry."},{status:409,headers});if(e instanceof Prisma.PrismaClientUnknownRequestError&&/code: "(23514|23503|22003)"/.test(e.message))return NextResponse.json({error:"Transfer source, unit or available stock constraint conflict. Keep the exact request for retry or cancellation."},{status:409,headers});throw e;}
}
