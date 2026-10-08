import {returnPurchaseVat} from "./purchase-vat";
import {Prisma} from "@prisma/client";
export type PurchaseDocumentKind="purchase-receipt"|"purchase-return";
export function isPurchaseDocument(kind:string):kind is PurchaseDocumentKind{return kind==="purchase-receipt"||kind==="purchase-return";}
export async function purchaseDocument(tx:Prisma.TransactionClient,kind:PurchaseDocumentKind,tenantId:string,id:string){
 if(kind==="purchase-receipt"){
  const row=await tx.goodsReceipt.findUnique({where:{tenantId_id:{tenantId,id}},include:{order:{select:{branchId:true,number:true,currency:true,supplierName:true}},lines:{include:{orderLine:{select:{unitPrice:true,description:true}},movement:{select:{id:true}}}}}});
  if(!row)return null;
  const ids=row.lines.flatMap(l=>l.movement?[l.movement.id]:[]);
  const reversed=ids.length?await tx.auditLog.count({where:{tenantId,entity:"StockMovement",entityId:{in:ids},action:"inventory-stock.reversed"}}):0;
  const vat=await tx.purchaseVat.findFirst({where:{receiptId:row.id,returnId:null}});
  const netAmount=row.lines.reduce((total,l)=>total.plus(l.quantity.mul(l.orderLine.unitPrice)),new Prisma.Decimal(0));
  return {vat,netAmount,supplierName:row.order.supplierName,purchaseLines:row.lines.map(l=>({id:l.id,quantity:l.quantity,unitPrice:l.orderLine.unitPrice,description:l.orderLine.description})),companyId:row.companyId,branchId:row.branchId,orderBranchId:row.order.branchId,receiptId:row.id,number:`${row.order.number} / ${row.id}`,currency:row.order.currency,date:row.createdAt.toISOString().slice(0,10),amount:netAmount.plus(vat?.taxAmount??0),eligible:row.lines.length>0&&ids.length===row.lines.length&&reversed===0};
 }
 const row=await tx.goodsReturn.findUnique({where:{id},include:{receipt:{include:{order:{select:{branchId:true,number:true,currency:true,supplierName:true}}}},lines:{include:{receiptLine:{select:{orderLine:{select:{unitPrice:true}}}}}}}});
 if(!row||row.tenantId!==tenantId)return null;
 const vat=await returnPurchaseVat(tx,row.receiptId,row.id,row.lines.map(l=>({receiptLineId:l.receiptLineId,quantity:l.quantity,unitPrice:l.receiptLine.orderLine.unitPrice})));
 const netAmount=row.lines.reduce((total,l)=>total.plus(l.receiptLine.orderLine.unitPrice.mul(l.quantity)),new Prisma.Decimal(0));
 return {vat,netAmount,supplierName:row.receipt.order.supplierName,purchaseLines:[],companyId:row.receipt.companyId,branchId:row.receipt.branchId,orderBranchId:row.receipt.order.branchId,receiptId:row.receiptId,number:`${row.receipt.order.number} / ${row.id}`,currency:row.receipt.order.currency,date:row.createdAt.toISOString().slice(0,10),amount:netAmount.plus(vat?.taxAmount??0),eligible:row.lines.length>0};
}
// Decode our UUID-derived base-36 reference without relying on editable audit metadata.
export function purchaseJournalSource(number:string){
 const match=/^SYS([GT])-([0-9A-Z]{25})$/.exec(number);if(!match)return null;
 let value=BigInt(0);for(const digit of match[2])value=value*BigInt(36)+BigInt(parseInt(digit,36));
 const hex=value.toString(16).padStart(32,"0");if(hex.length!==32)return null;
 return {kind:match[1]==="G"?"purchase-receipt" as const:"purchase-return" as const,id:`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`};
}
export async function returnJournalDependencies(tx:Prisma.TransactionClient,tenantId:string,companyId:string,receiptId:string){
 const [row]=await tx.$queryRaw<{active:boolean;latestDate:Date|null}[]>`
  SELECT COALESCE(bool_or(rev.id IS NULL),false) AS active, max(COALESCE(rev."entryDate",j."entryDate")) AS "latestDate"
  FROM "GoodsReturn" r
  JOIN "AuditLog" a ON a."tenantId"=r."tenantId" AND a."entity"='GoodsReturn' AND a."entityId"=r.id::text AND a."action"='purchase-return.ledger_posted'
  JOIN "JournalEntry" j ON j.id=(a.metadata->>'journalId')::uuid AND j."tenantId"=${tenantId}::uuid AND j."companyId"=${companyId}::uuid
  LEFT JOIN "JournalEntry" rev ON rev."reversalOf"=j.id
  WHERE r."tenantId"=${tenantId}::uuid AND r."receiptId"=${receiptId}::uuid`;
 return {active:row?.active??false,latestDate:row?.latestDate?.toISOString().slice(0,10)??null};
}
