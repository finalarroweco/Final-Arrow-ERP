import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {customerStatement,customerStatementCsv,CustomerStatementError} from "@/lib/customer-statement";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))return NextResponse.json({error:"Duplicate statement filter"},{status:400});
 try{const result=await customerStatement(actor.id,Object.fromEntries(params));
  if(result.format==="csv")return new Response("\uFEFF"+customerStatementCsv(result),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="customer-statement-${result.from}-${result.to}.csv"`,"Cache-Control":"private, no-store"}});
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof CustomerStatementError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
