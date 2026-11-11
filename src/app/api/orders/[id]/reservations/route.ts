import { apiJson } from "@/lib/api-response";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {orderStockHoldRequest} from "@/lib/order-stock-hold-input";
import {changeReservation,reservationFailure,reservationDetails,stockRights,orderRights} from "@/lib/stock-reservation-service";
const uuid=z.string().uuid().transform(s=>s.toLowerCase());
const filters=z.object({expectedActorId:uuid.optional(),tenantId:uuid,companyId:uuid,branchId:uuid,page:z.coerce.number().int().min(0).max(100000).default(0),state:z.enum(["ACTIVE","RELEASED","ALL"]).default("ACTIVE")}).strict();
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 const id=uuid.safeParse((await params).id),query=new URL(request.url).searchParams,p=filters.safeParse(Object.fromEntries(query));
 if(!id.success||!p.success||[...query.keys()].some(k=>query.getAll(k).length!==1))return apiJson({error:"Invalid order reservation filters"},{status:400});
 if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403,headers:{"Cache-Control":"private, no-store"}});
 const {tenantId,companyId,branchId,page,state}=p.data;
 try{const rows=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR SHARE`;
  await orderRights(tx,actor.id,{tenantId,companyId,branchId},id.data,false,false);
  await stockRights(tx,actor.id,{tenantId,companyId,branchId},false);
  return tx.stockReservation.findMany({where:{tenantId,orderLink:{orderId:id.data,companyId,branchId},...(state==="ACTIVE"?{releasedAt:null}:state==="RELEASED"?{releasedAt:{not:null}}:{})},include:reservationDetails,orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51});
 });return apiJson({actorId:actor.id,reservations:rows.slice(0,50),page,nextPage:rows.length>50?page+1:null},{headers:{"Cache-Control":"private, no-store"}});}
 catch(error){const {status,...failure}=reservationFailure(error);return apiJson(failure,{status});}
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
 const id=uuid.safeParse((await params).id),p=orderStockHoldRequest.safeParse(await request.json().catch(()=>null));
 if(!id.success||!p.success)return apiJson({error:"Invalid order reservation request"},{status:400});
 try{return apiJson({reservation:await changeReservation(actor.id,p.data,id.data)},{status:201,headers:{"Cache-Control":"private, no-store"}});}
 catch(error){const {status,...failure}=reservationFailure(error);return apiJson(failure,{status});}
}
