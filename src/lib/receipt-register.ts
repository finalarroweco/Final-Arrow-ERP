import { z } from "zod";
import { db } from "./db";
import { readableCompanyPermissions } from "./access";
import { dueDate } from "./date";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.optional(),q:z.string().trim().max(120).default(""),page:z.coerce.number().int().min(0).max(100000).default(0),from:dueDate.optional(),to:dueDate.optional(),format:z.enum(["json","csv"]).default("json")}).strict().refine(v=>(!v.from&&!v.to)||Boolean(v.from&&v.to&&v.to>=v.from&&(Date.parse(v.to)-Date.parse(v.from))/86400000<366)).refine(v=>v.format!=="csv"||Boolean(v.from&&v.to&&v.page===0));
export class ReceiptRegisterError extends Error { constructor(message:string,public status:number){super(message);} }
export async function receiptRegister(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new ReceiptRegisterError("Invalid receipt filters",400);
 const {tenantId,companyId,branchId,q,page,from,to,format}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["purchase-order:read","inventory-stock:read"]});
 const purchase=rights["purchase-order:read"],stock=rights["inventory-stock:read"];
 if(purchase===false||stock===false||(branchId&&stock!==null&&!stock.includes(branchId)))throw new ReceiptRegisterError("Forbidden",403);
 return db.$transaction(async tx=>{
 const rows=await tx.goodsReceipt.findMany({where:{tenantId,companyId,
   ...(from&&to?{createdAt:{gte:new Date(`${from}T00:00:00.000Z`),lt:new Date(Date.parse(`${to}T00:00:00.000Z`)+86400000)}}:{}),
   ...(branchId?{branchId}:stock===null?{}:{branchId:{in:stock}}),
   order:{...(purchase===null?{}:{branchId:{in:purchase}})},
   ...(q?{OR:[...(uuid.safeParse(q).success?[{id:q}]:[]),{order:{number:{contains:q,mode:"insensitive" as const}}},{order:{supplierName:{contains:q,mode:"insensitive" as const}}}]}:{}),
 },orderBy:[{createdAt:"desc"},{id:"asc"}],skip:format==="csv"?0:page*50,take:format==="csv"?501:51,
 select:{id:true,createdAt:true,branchId:true,branch:{select:{name:true}},order:{select:{id:true,number:true,supplierName:true}},_count:{select:{lines:true}},lines:{select:{movement:{select:{id:true}}}}}});
 if(format==="csv"&&rows.length>500)throw new ReceiptRegisterError("Export exceeds 500 receipts. Narrow the date range or filters.",413);
 const visible=format==="csv"?rows:rows.slice(0,50),movementIds=visible.flatMap(r=>r.lines.flatMap(line=>line.movement?[line.movement.id]:[]));
 if(movementIds.length>25000)throw new ReceiptRegisterError("Export has too many stock lines. Narrow the filters.",413);
 const events=movementIds.length?await tx.auditLog.findMany({where:{tenantId,entity:"StockMovement",action:"inventory-stock.reversed",entityId:{in:movementIds}},select:{entityId:true}}):[];
 const corrected=new Set(events.map(event=>event.entityId));
 return {receipts:visible.map(({lines,...receipt})=>({...receipt,correctedLineCount:lines.filter(line=>line.movement&&corrected.has(line.movement.id)).length})),nextPage:format==="json"&&rows.length>50?page+1:null,page,from,to,format};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}

export function receiptRegisterCsv(result:Awaited<ReturnType<typeof receiptRegister>>){
 const cell=(value:string)=>`"${(/^[\s\u0000-\u001f]*[=+@-]/u.test(value)?`'${value}`:value).replaceAll('"','""')}"`;
 return [["Receipt ID","Order","Supplier","Receiving branch","Received at (UTC)","Original lines","Corrected stock lines"],...result.receipts.map(r=>[r.id,r.order.number,r.order.supplierName,r.branch.name,r.createdAt.toISOString(),String(r._count.lines),String(r.correctedLineCount)])].map(row=>row.map(cell).join(",")).join("\r\n");
}
