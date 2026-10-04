import {z} from "zod";
import {canAccess} from "./access";
import {db} from "./db";
export async function readableGoodsReceipt(userId:string,id:string){
 if(!z.string().uuid().safeParse(id).success)return null;
 const scope=await db.goodsReceipt.findUnique({where:{id},select:{tenantId:true,companyId:true,branchId:true,order:{select:{branchId:true}}}});
 if(!scope)return null;
 const base={userId,tenantId:scope.tenantId,companyId:scope.companyId};
 if(!(await canAccess({...base,branchId:scope.branchId,permission:"inventory-stock:read"}))||!(await canAccess({...base,branchId:scope.order.branchId??undefined,permission:"purchase-order:read"})))return null;
 return db.goodsReceipt.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},order:{select:{id:true,number:true,supplierName:true}},lines:{select:{id:true,quantity:true,orderLine:{select:{position:true,description:true}},item:{select:{sku:true,name:true,unit:true}},movement:{select:{id:true,type:true,delta:true}}},orderBy:[{orderLine:{position:"asc"}},{id:"asc"}]}}});
}
