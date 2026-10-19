import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess,readableCompanyBranches} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../../../pos/[id]/print";
import {LanguageSwitcher} from "../../../language-switcher";
export default async function PurchaseOrderDocument({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const source=await db.purchaseOrder.findUnique({where:{id},select:{tenantId:true,companyId:true,branchId:true}});
 if(!source||!(await canAccess({userId:actor.id,tenantId:source.tenantId,companyId:source.companyId,branchId:source.branchId??undefined,permission:"purchase-order:read"})))notFound();
 const stock=await readableCompanyBranches({userId:actor.id,tenantId:source.tenantId,companyId:source.companyId,permission:"inventory-stock:read"});
 const {order,receipts}=await db.$transaction(async tx=>({
  order:await tx.purchaseOrder.findUniqueOrThrow({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},lines:{orderBy:{position:"asc"}}}}),
  receipts:stock===false?[]:await tx.goodsReceipt.findMany({where:{tenantId:source.tenantId,companyId:source.companyId,orderId:id,...(stock===null?{}:{branchId:{in:stock}})},select:{id:true,createdAt:true},orderBy:[{createdAt:"desc"},{id:"asc"}],take:10})
 }),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000});
 const partial=order.status==="ISSUED"&&order.lines.some(l=>l.receivedQuantity>0);
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const stamp=(date:Date)=>`${date.toISOString().replace("T"," ").slice(0,16)} UTC`;
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style><header className="no-print"><a href="/purchasing/orders">{t("Back to purchase orders","العودة لأوامر الشراء")}</a><LanguageSwitcher locale={locale}/><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header><section className="panel"><h1>{order.company.name}</h1><h2>{t("Purchase order","أمر شراء")}: {order.number}</h2><p><strong>{partial?t("Partially received","مستلم جزئيًا"):t(order.status,{DRAFT:"مسودة — لم تُصدر",ISSUED:"مصدرة",RECEIVED:"مستلم",CANCELLED:"ملغى"}[order.status])}</strong></p><p>{t("Supplier","المورد")}: {order.supplierName}</p><p>{t("Branch","الفرع")}: {order.branch?.name??t("Company wide","على مستوى الشركة")}</p><p>{t("Created","تاريخ الإنشاء")}: {stamp(order.createdAt)}</p>{order.issuedAt&&<p>{t("Issued","تاريخ الإصدار")}: {stamp(order.issuedAt)}</p>}{order.receivedAt&&<p>{t("Received","تاريخ الاستلام")}: {stamp(order.receivedAt)}</p>}{order.cancelledAt&&<p>{t("Cancelled","تاريخ الإلغاء")}: {stamp(order.cancelledAt)}</p>}{receipts.map(receipt=><p key={receipt.id} className="no-print"><a href={`/purchasing/receipts/${receipt.id}`}>{t("View goods receipt","عرض مستند الاستلام")} · {stamp(receipt.createdAt)}</a></p>)}{receipts.length>0&&<p className="no-print"><a href={`/purchasing/receipts?${new URLSearchParams({scope:`${order.tenantId}:${order.companyId}`,q:order.number})}`}>{t("Search all receipts for this order","البحث في كل استلامات هذا الأمر")}</a></p>}<table><thead><tr><th>{t("Description","الوصف")}</th><th>{t("Quantity","الكمية")}</th><th>{t("Received","المستلم")}</th><th>{t("Remaining","المتبقي")}</th><th>{t("Unit price","سعر الوحدة")}</th><th>{t("Amount","المبلغ")}</th></tr></thead><tbody>{order.lines.map(line=><tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{line.receivedQuantity}</td><td>{line.quantity-line.receivedQuantity}</td><td>{line.unitPrice.toFixed(3)}</td><td>{line.amount.toFixed(3)}</td></tr>)}</tbody></table><h2>{t("Subtotal","المجموع الفرعي")}: {order.subtotal.toFixed(3)} {order.currency}</h2>{order.notes&&<p>{t("Notes","ملاحظات")}: {order.notes}</p>}<p>{t("Internal purchase document. Tax, supplier payments and payables are not recorded on this document.","مستند شراء داخلي. الضرائب ومدفوعات المورد والذمم غير مسجّلة في هذا المستند.")}</p></section></main>;
}
