import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {posScope} from "@/lib/pos";
import {queryInput} from "@/lib/ledger";
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const parsed=posScope.extend({status:z.enum(["WAITING","PREPARING","READY","SERVED"]).optional(),page:z.coerce.number().int().min(0).max(100000).default(0)}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","status","page"]));
 if(!parsed.success)return NextResponse.json({error:"Invalid kitchen filters"},{status:400});const {tenantId,companyId,branchId,status,page}=parsed.data;
 if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"})))return NextResponse.json({error:"Forbidden"},{status:403});
 const orders=await db.posOrder.findMany({where:{tenantId,companyId,branchId,status:{not:"CANCELLED"},kitchenStatus:status??{in:["WAITING","PREPARING","READY"]}},
 select:{id:true,number:true,type:true,tableLabel:true,note:true,status:true,kitchenStatus:true,createdAt:true,prepStartedAt:true,readyAt:true,servedAt:true,lines:{select:{id:true,itemName:true,quantity:true},orderBy:{position:"asc"}}},orderBy:[{createdAt:"asc"},{id:"asc"}],skip:page*50,take:51});
 const [clock]=await db.$queryRaw<{stamp:Date}[]>`SELECT clock_timestamp() AS stamp`;
 return NextResponse.json({serverTime:clock.stamp.toISOString(),orders:orders.slice(0,50),nextPage:orders.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});
}
