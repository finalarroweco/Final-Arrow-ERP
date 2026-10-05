import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {receiptRegister,ReceiptRegisterError} from "@/lib/receipt-register";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))return NextResponse.json({error:"Duplicate receipt filter"},{status:400});
 try{return NextResponse.json(await receiptRegister(actor.id,Object.fromEntries(params)),{headers:{"Cache-Control":"private, no-store"}});}
 catch(error){if(error instanceof ReceiptRegisterError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
