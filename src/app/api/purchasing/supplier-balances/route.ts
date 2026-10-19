import {NextResponse} from "next/server";
import {currentUser} from "@/lib/auth";
import {supplierBalances,supplierBalancesCsv,SupplierBalanceError} from "@/lib/supplier-balances";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams;
 if([...params.keys()].some(key=>params.getAll(key).length!==1))return NextResponse.json({error:"Duplicate statement filter"},{status:400});
 try{const result=await supplierBalances(actor.id,Object.fromEntries(params));
  if(result.format==="csv")return new Response("\uFEFF"+supplierBalancesCsv(result),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="supplier-balances-${result.asOf}.csv"`,"Cache-Control":"private, no-store"}});
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){if(error instanceof SupplierBalanceError)return NextResponse.json({error:error.message},{status:error.status});throw error;}
}
