import { apiJson } from "@/lib/api-response";
import {Prisma} from "@prisma/client";
import {currentUser} from "@/lib/auth";
import {stockTransferRequest} from "@/lib/stock-transfer-input";
import {createStockTransfer,listStockTransfers,StockTransferError,transferFilters} from "@/lib/stock-transfers";
const headers={"Cache-Control":"private, no-store"};
function transferFailure(e:unknown){if(e instanceof StockTransferError)return apiJson({error:e.message},{status:e.status,headers});if(e instanceof Prisma.PrismaClientKnownRequestError&&["P2002","P2003","P2004","P2010","P2034"].includes(e.code))return apiJson({error:"Transfer conflict. Check branch access, active company-wide item, original unit, available stock and balance limit. Keep the same request for a safe retry."},{status:409,headers});if(e instanceof Prisma.PrismaClientUnknownRequestError&&/code: "(23514|23503|22003)"/.test(e.message))return apiJson({error:"Transfer source, unit or available stock constraint conflict. Keep the exact request for retry or cancellation."},{status:409,headers});throw e;}
export async function POST(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401,headers});
 const p=stockTransferRequest.safeParse(await request.json().catch(()=>null));if(!p.success)return apiJson({error:"Invalid transfer request"},{status:400,headers});
 if(p.data.expectedActorId!==actor.id)return apiJson({error:"This saved request belongs to a different signed-in user"},{status:403,headers});
 try{return apiJson({transfer:await createStockTransfer(actor.id,p.data)},{status:201,headers});}catch(e){return transferFailure(e);}
}
const cell=(v:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(v)?`'${v}`:v).replaceAll('"','""')}"`;
export async function GET(request:Request){
 const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401,headers});
 const params=new URL(request.url).searchParams,p=transferFilters.safeParse(Object.fromEntries(params));if(!p.success||[...params.keys()].some(k=>params.getAll(k).length!==1))return apiJson({error:"Invalid transfer filters"},{status:400,headers});
 if(p.data.expectedActorId&&p.data.expectedActorId!==actor.id)return apiJson({error:"Signed-in user changed. Reload this workspace."},{status:403,headers});
 try{const result=await listStockTransfers(actor.id,p.data);if(p.data.format!=="csv")return apiJson({actorId:actor.id,...result},{headers});
  const rows=[["Transfer ID","Recorded at (UTC)","Company","From branch","To branch","SKU","Item","Quantity","Stock unit","Reference","Reason","Recorded by","Corrects transfer"],...result.transfers.map(t=>[t.id,t.createdAt,t.companyName,t.sourceBranchName,t.destinationBranchName,t.itemSku,t.itemName,t.quantity,t.unit,t.reference,t.reason,t.actorName,t.correctsId??""])];
  return new Response('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n',{headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="branch-stock-transfers.csv"'}});
 }catch(e){return transferFailure(e);}
}
