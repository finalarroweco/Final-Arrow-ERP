import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {customerBalances,CustomerBalanceError} from "@/lib/customer-balances";
import {sourceAgingCsv} from "@/lib/source-aging";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;if([...params.keys()].some(key=>params.getAll(key).length!==1))return NextResponse.json({error:"Duplicate aging filter"},{status:400});
 try{const result=await customerBalances(actor.id,Object.fromEntries(params),true),report=result.aging!;
 if(result.format==="csv")return new Response("\uFEFF"+sourceAgingCsv(report),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="customer-aging-${result.asOf}.csv"`,"Cache-Control":"private, no-store"}});
 return NextResponse.json(report,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof CustomerBalanceError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
