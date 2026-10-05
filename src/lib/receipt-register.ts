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
 const rows=await db.goodsReceipt.findMany({where:{tenantId,companyId,
   ...(branchId?{branchId}:stock===null?{}:{branchId:{in:stock}}),
   order:{...(purchase===null?{}:{branchId:{in:purchase}})},
   ...(q?{OR:[...(uuid.safeParse(q).success?[{id:q}]:[]),{order:{number:{contains:q,mode:"insensitive" as const}}},{order:{supplierName:{contains:q,mode:"insensitive" as const}}}]}:{}),
 },orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51,
 select:{id:true,createdAt:true,branchId:true,branch:{select:{name:true}},order:{select:{id:true,number:true,supplierName:true}},_count:{select:{lines:true}}}});
 return {receipts:rows.slice(0,50),nextPage:rows.length>50?page+1:null,page};
}
