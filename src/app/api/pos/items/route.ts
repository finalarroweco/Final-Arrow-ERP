import { apiJson } from "@/lib/api-response";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { db } from "@/lib/db";
import { queryInput } from "@/lib/ledger";
import { posScope, posMoney, posNumber } from "@/lib/pos";
export async function GET(request: Request) {
  const actor = await currentUser(); if(!actor) return apiJson({error:"Unauthenticated"},{status:401});
  const parsed = posScope.extend({page:z.coerce.number().int().min(0).max(100000).default(0), includeInactive:z.enum(["true","false"]).default("false")}).safeParse(queryInput(new URL(request.url).searchParams,["tenantId","companyId","branchId","page","includeInactive"]));
  if(!parsed.success) return apiJson({error:"Invalid POS scope"},{status:400});
  const {tenantId,companyId,branchId,page,includeInactive}=parsed.data;
  if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId,permission:"pos:read"}))) return apiJson({error:"Forbidden"},{status:403});
  const items=await db.posItem.findMany({where:{tenantId,companyId,OR:[{branchId},{branchId:null}],...(includeInactive==="false"?{active:true}:{})},orderBy:[{category:"asc"},{name:"asc"},{id:"asc"}],skip:page*100,take:101});
  return apiJson({items:items.slice(0,100),nextPage:items.length>100?page+1:null});
}
export async function POST(request: Request) {
  const actor=await currentUser();if(!actor)return apiJson({error:"Unauthenticated"},{status:401});
  const parsed=posScope.omit({branchId:true}).extend({branchId:z.string().uuid().nullish(),code:posNumber,name:z.string().trim().min(2).max(200),category:z.string().trim().min(2).max(80),price:posMoney.refine((value)=>Number(value)>0)}).strict().safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return apiJson({error:"Invalid menu item"},{status:400});
  const {tenantId,companyId,branchId,...data}=parsed.data;
  if(!(await canAccess({userId:actor.id,tenantId,companyId,branchId:branchId??undefined,permission:"pos:manage"})))return apiJson({error:"Forbidden"},{status:403});
  const company=await db.company.findUnique({where:{tenantId_id:{tenantId,id:companyId}},select:{baseCurrency:true}});
  if(!company||(branchId&&!(await db.branch.findUnique({where:{tenantId_companyId_id:{tenantId,companyId,id:branchId}},select:{id:true}}))))return apiJson({error:"Company or branch not found"},{status:404});
  try{const item=await db.$transaction(async(tx)=>{const item=await tx.posItem.create({data:{tenantId,companyId,branchId:branchId??null,...data,currency:company.baseCurrency,createdBy:actor.id}});await tx.auditLog.create({data:{tenantId,actorId:actor.id,action:"pos-item.created",entity:"PosItem",entityId:item.id}});return item;});return apiJson({item},{status:201});}
  catch(error){if(error instanceof Error&&"code" in error&&error.code==="P2002")return apiJson({error:"Menu code already in use"},{status:409});throw error;}
}
