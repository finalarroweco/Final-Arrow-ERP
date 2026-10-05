import { z } from "zod";
import { db } from "./db";
import { readableCompanyPermissions } from "./access";
const uuid=z.string().uuid();
const filters=z.object({tenantId:uuid,companyId:uuid,branchId:uuid.optional(),q:z.string().trim().max(120).default(""),page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export class ReceiptRegisterError extends Error { constructor(message:string,public status:number){super(message);} }
export async function receiptRegister(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new ReceiptRegisterError("Invalid receipt filters",400);
 const {tenantId,companyId,branchId,q,page}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["purchase-order:read","inventory-stock:read"]});
 const purchase=rights["purchase-order:read"],stock=rights["inventory-stock:read"];
 if(purchase===false||stock===false||(branchId&&stock!==null&&!stock.includes(branchId)))throw new ReceiptRegisterError("Forbidden",403);
 return db.$transaction(async tx=>{
 const rows=await tx.goodsReceipt.findMany({where:{tenantId,companyId,
   ...(branchId?{branchId}:stock===null?{}:{branchId:{in:stock}}),
   order:{...(purchase===null?{}:{branchId:{in:purchase}})},
   ...(q?{OR:[...(uuid.safeParse(q).success?[{id:q}]:[]),{order:{number:{contains:q,mode:"insensitive" as const}}},{order:{supplierName:{contains:q,mode:"insensitive" as const}}}]}:{}),
 },orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51,
 select:{id:true,createdAt:true,branchId:true,branch:{select:{name:true}},order:{select:{id:true,number:true,supplierName:true}},_count:{select:{lines:true}},lines:{select:{movement:{select:{id:true}}}}}});
 const visible=rows.slice(0,50),movementIds=visible.flatMap(r=>r.lines.flatMap(line=>line.movement?[line.movement.id]:[]));
 const events=movementIds.length?await tx.auditLog.findMany({where:{tenantId,entity:"StockMovement",action:"inventory-stock.reversed",entityId:{in:movementIds}},select:{entityId:true}}):[];
 const corrected=new Set(events.map(event=>event.entityId));
 return {receipts:visible.map(({lines,...receipt})=>({...receipt,correctedLineCount:lines.filter(line=>line.movement&&corrected.has(line.movement.id)).length})),nextPage:rows.length>50?page+1:null,page};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
