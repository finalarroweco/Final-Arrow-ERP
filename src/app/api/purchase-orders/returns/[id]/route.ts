import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {readableGoodsReturn} from "@/lib/goods-return";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const {id}=await params,goodsReturn=await readableGoodsReturn(actor.id,id);
 return goodsReturn?NextResponse.json({goodsReturn},{headers:{"Cache-Control":"private, no-store"}}):NextResponse.json({error:"Return not found"},{status:404});
}
