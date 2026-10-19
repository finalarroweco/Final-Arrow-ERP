import {z} from "zod";
import {canAccess} from "./access";
import {db} from "./db";
export async function readableGoodsReturn(userId:string,id:string){
 if(!z.string().uuid().safeParse(id).success)return null;
 const scope=await db.goodsReturn.findUnique({where:{id},select:{tenantId:true,receipt:{select:{companyId:true,branchId:true,order:{select:{branchId:true}}}}}});
 if(!scope)return null;
 const base={userId,tenantId:scope.tenantId,companyId:scope.receipt.companyId};
 const rights=await Promise.all([canAccess({...base,branchId:scope.receipt.branchId,permission:"inventory-stock:read"}),canAccess({...base,branchId:scope.receipt.order.branchId??undefined,permission:"purchase-order:read"})]);
 if(!rights.every(Boolean))return null;
 return db.goodsReturn.findUnique({where:{id},include:{receipt:{include:{company:{select:{name:true}},branch:{select:{name:true}},order:{select:{id:true,number:true,supplierName:true}}}},lines:{include:{receiptLine:{select:{item:{select:{name:true,sku:true,unit:true}},orderLine:{select:{description:true,position:true}}}}},orderBy:[{receiptLine:{orderLine:{position:"asc"}}},{id:"asc"}]}}});
}
