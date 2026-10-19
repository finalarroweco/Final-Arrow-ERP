import {documentJournalNumber} from "./document-journal";
import {z} from "zod";
import {db} from "./db";
import {readableCompanyPermissions} from "./access";
const uuid=z.string().uuid(),filters=z.object({tenantId:uuid,companyId:uuid,q:z.string().trim().max(120).default(""),page:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export class ReturnRegisterError extends Error {constructor(message:string,public status:number){super(message);}}
export async function returnRegister(userId:string,raw:unknown){
 const parsed=filters.safeParse(raw);if(!parsed.success)throw new ReturnRegisterError("Invalid return filters",400);
 const {tenantId,companyId,q,page}=parsed.data;
 const rights=await readableCompanyPermissions({userId,tenantId,companyId,permissions:["purchase-order:read","inventory-stock:read","ledger:read"]});
 const purchase=rights["purchase-order:read"],stock=rights["inventory-stock:read"];
 if(purchase===false||stock===false)throw new ReturnRegisterError("Forbidden",403);
 return db.$transaction(async tx=>{
 const rows=await tx.goodsReturn.findMany({where:{tenantId,receipt:{companyId,...(stock===null?{}:{branchId:{in:stock}}),order:purchase===null?{}:{branchId:{in:purchase}}},...(q?{OR:[...(uuid.safeParse(q).success?[{id:q},{receiptId:q}]:[]),{reason:{contains:q,mode:"insensitive" as const}},{receipt:{order:{number:{contains:q,mode:"insensitive" as const}}}},{receipt:{order:{supplierName:{contains:q,mode:"insensitive" as const}}}}]}:{})},orderBy:[{createdAt:"desc"},{id:"asc"}],skip:page*50,take:51,select:{id:true,receiptId:true,reason:true,createdAt:true,_count:{select:{lines:true}},receipt:{select:{branchId:true,branch:{select:{name:true}},order:{select:{number:true,supplierName:true}}}}}});
 const visible=rows.slice(0,50),ledger=rights["ledger:read"];
 const financial=visible.filter(r=>ledger===null||(Array.isArray(ledger)&&ledger.includes(r.receipt.branchId)));
 const entries=financial.length?await tx.journalEntry.findMany({where:{tenantId,companyId,number:{in:financial.flatMap(r=>[documentJournalNumber("purchase-return",r.id),documentJournalNumber("purchase-receipt",r.receiptId)])}},select:{id:true,number:true,reversal:{select:{id:true,number:true}}}}):[];
 const byNumber=new Map(entries.map(e=>[e.number,e]));
 return {returns:visible.map(r=>{
  const accessible=ledger===null||(Array.isArray(ledger)&&ledger.includes(r.receipt.branchId));
  const entry=accessible?byNumber.get(documentJournalNumber("purchase-return",r.id)):undefined;
  const original=accessible?byNumber.get(documentJournalNumber("purchase-receipt",r.receiptId)):undefined;
  return {...r,financialStatus:!accessible?"no_access":entry?(entry.reversal?"reversed":"posted"):!original?"source_unposted":original.reversal?"source_reversed":"unposted",entry:entry??null};
 }),page,nextPage:rows.length>50?page+1:null};
 },{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
}
