import {NextResponse} from "next/server";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {reservationRequest,reservationScope} from "@/lib/stock-reservation-input";
import {changeReservation,reservationFailure,stockRights} from "@/lib/stock-reservation-service";
const filters=reservationScope.extend({page:z.coerce.number().int().min(0).max(100000).default(0),state:z.enum(["ACTIVE","RELEASED","ALL"]).default("ACTIVE"),itemId:z.string().uuid().optional()}).strict();
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const params=new URL(request.url).searchParams,p=filters.safeParse(Object.fromEntries(params));if(!p.success||[...params.keys()].some(k=>params.getAll(k).length!==1))return NextResponse.json({error:"Invalid reservation filters"},{status:400});
 const {tenantId,companyId,branchId,page,state,itemId}=p.data;
 try{const rows=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
  await stockRights(tx,actor.id,{tenantId,companyId,branchId},false);
  return tx.stockReservation.findMany({where:{tenantId,sourceKind:"MANUAL",orderLink:null,balance:{tenantId,companyId,branchId,...(itemId?{itemId}:{})},...(state==="ACTIVE"?{releasedAt:null}:state==="RELEASED"?{releasedAt:{not:null}}:{})},select:{id:true,balanceId:true,quantity:true,reference:true,createdAt:true,releasedAt:true,releaseReason:true,balance:{select:{itemId:true,item:{select:{sku:true,name:true,unit:true}}}}},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});
 });return NextResponse.json({reservations:rows.slice(0,50),page,nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}
 catch(error){const {status,...failure}=reservationFailure(error);return NextResponse.json(failure,{status});}
}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return NextResponse.json({error:"Unauthenticated"},{status:401});
 const p=reservationRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return NextResponse.json({error:"Invalid reservation request"},{status:400});
 try{return NextResponse.json({reservation:await changeReservation(actor.id,p.data)},{status:201,headers:{"Cache-Control":"private, no-store"}});}
 catch(error){const {status,...failure}=reservationFailure(error);return NextResponse.json(failure,{status});}
}
