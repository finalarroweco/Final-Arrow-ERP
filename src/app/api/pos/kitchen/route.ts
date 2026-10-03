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
 const result=await db.$transaction(async tx=>{
 const scope={tenantId,companyId,branchId,status:{not:"CANCELLED" as const}};
 const orders=await tx.posOrder.findMany({where:{tenantId,companyId,branchId,status:{not:"CANCELLED"},kitchenStatus:status??{in:["WAITING","PREPARING","READY"]}},
 select:{id:true,number:true,type:true,tableLabel:true,note:true,status:true,kitchenStatus:true,createdAt:true,prepStartedAt:true,readyAt:true,servedAt:true,lines:{select:{id:true,itemName:true,quantity:true},orderBy:{position:"asc"}}},orderBy:[{createdAt:"asc"},{id:"asc"}],skip:page*50,take:51});
 const groups=await tx.posOrder.groupBy({by:["kitchenStatus"],where:{...scope,kitchenStatus:{in:["WAITING","PREPARING","READY"]}},_count:{_all:true},_min:{createdAt:true,prepStartedAt:true,readyAt:true}});
 const summary=groups.map(group=>({status:group.kitchenStatus,count:group._count._all,oldestStageAt:group.kitchenStatus==="WAITING"?group._min.createdAt:group.kitchenStatus==="PREPARING"?group._min.prepStartedAt:group._min.readyAt}));
 const [clock]=await tx.$queryRaw<{stamp:Date}[]>`SELECT clock_timestamp() AS stamp`;
 return {serverTime:clock.stamp.toISOString(),summary,orders:orders.slice(0,50),nextPage:orders.length>50?page+1:null};
 },{isolationLevel:"RepeatableRead"});
 return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
}
