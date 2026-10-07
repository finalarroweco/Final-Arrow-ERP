import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {returnRegister,ReturnRegisterError} from "@/lib/return-register";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(k=>params.getAll(k).length!==1))return NextResponse.json({error:"Duplicate return filter"},{status:400});
 try{return NextResponse.json(await returnRegister(actor.id,Object.fromEntries(params)),{headers:{"Cache-Control":"private, no-store"}});}
 catch(e){if(e instanceof ReturnRegisterError)return NextResponse.json({error:e.message},{status:e.status});throw e;}
}
