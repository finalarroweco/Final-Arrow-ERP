import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "@/app/language-switcher";
import {SalesStockWorkspace} from "./workspace";
export default async function OrderDeliveriesPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");
 const id=z.string().uuid().transform(s=>s.toLowerCase()).safeParse((await params).id);if(!id.success)notFound();
 const source=await db.salesOrder.findUnique({where:{id:id.data},select:{tenantId:true}});if(!source)notFound();
 const data=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id=${source.tenantId}::uuid FOR SHARE`;
  const order=await tx.salesOrder.findUnique({where:{id:id.data},select:{id:true,tenantId:true,companyId:true,branchId:true,number:true,status:true,lines:{select:{id:true,position:true,description:true},orderBy:{position:"asc"}}}});if(!order)return null;
  const scope={userId:actor.id,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId??undefined};
  if(!await canAccess({...scope,permission:"order:read"},tx))return null;
  const manage=await canAccess({...scope,permission:"order-delivery:manage"},tx);
  const reserve=await canAccess({...scope,permission:"order-reservation:manage"},tx);
  const candidates=await tx.branch.findMany({where:{tenantId:order.tenantId,companyId:order.companyId,...(order.branchId?{id:order.branchId}:{})},select:{id:true,name:true},orderBy:[{name:"asc"},{id:"asc"}]});
  const branches=[];
  for(const branch of candidates){
   const stockScope={...scope,branchId:branch.id};if(!await canAccess({...stockScope,permission:"inventory-stock:read"},tx))continue;
   branches.push({...branch,canManage:manage&&await canAccess({...stockScope,permission:"inventory-stock:adjust"},tx),canDeliverHold:manage&&reserve&&await canAccess({...stockScope,permission:"inventory-stock:adjust"},tx),items:await tx.inventoryItem.findMany({where:{tenantId:order.tenantId,companyId:order.companyId,archivedAt:null,OR:[{branchId:null},{branchId:branch.id}]},select:{id:true,sku:true,name:true,unit:true},orderBy:[{name:"asc"},{id:"asc"}]})});
  }
  return {order,branches};
 },{timeout:15000});if(!data || !data.branches.length)notFound();
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href={`/sales/orders/${id.data}`}>{t("Order document","مستند الطلب")}</a><a href="/sales/orders">{t("Orders","الطلبات")}</a></header><section className="hero"><h1>{data.order.number} · {t("Physical deliveries and returns","التسليم الفعلي والمرتجعات")}</h1></section><SalesStockWorkspace key={`${actor.id}:${data.order.id}`} actorId={actor.id} order={data.order} branches={data.branches} locale={locale}/></main>;
}
