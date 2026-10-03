import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../../../pos/[id]/print";
import {LanguageSwitcher} from "../../../language-switcher";
export default async function PurchaseOrderDocument({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const order=await db.purchaseOrder.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},lines:{orderBy:{position:"asc"}}}});
 if(!order||!(await canAccess({userId:actor.id,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId??undefined,permission:"purchase-order:read"})))notFound();
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const stamp=(date:Date)=>`${date.toISOString().replace("T"," ").slice(0,16)} UTC`;
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style><header className="no-print"><a href="/purchasing/orders">{t("Back to purchase orders","العودة لأوامر الشراء")}</a><LanguageSwitcher locale={locale}/><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header><section className="panel"><h1>{order.company.name}</h1><h2>{t("Purchase order","أمر شراء")}: {order.number}</h2><p><strong>{t(order.status,{DRAFT:"مسودة — لم تُصدر",ISSUED:"مصدرة",RECEIVED:"مستلم",CANCELLED:"ملغى"}[order.status])}</strong></p><p>{t("Supplier","المورد")}: {order.supplierName}</p><p>{t("Branch","الفرع")}: {order.branch?.name??t("Company wide","على مستوى الشركة")}</p><p>{t("Created","تاريخ الإنشاء")}: {stamp(order.createdAt)}</p>{order.issuedAt&&<p>{t("Issued","تاريخ الإصدار")}: {stamp(order.issuedAt)}</p>}{order.receivedAt&&<p>{t("Received","تاريخ الاستلام")}: {stamp(order.receivedAt)}</p>}{order.cancelledAt&&<p>{t("Cancelled","تاريخ الإلغاء")}: {stamp(order.cancelledAt)}</p>}<table><thead><tr><th>{t("Description","الوصف")}</th><th>{t("Quantity","الكمية")}</th><th>{t("Unit price","سعر الوحدة")}</th><th>{t("Amount","المبلغ")}</th></tr></thead><tbody>{order.lines.map(line=><tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{line.unitPrice.toFixed(3)}</td><td>{line.amount.toFixed(3)}</td></tr>)}</tbody></table><h2>{t("Subtotal","المجموع الفرعي")}: {order.subtotal.toFixed(3)} {order.currency}</h2>{order.notes&&<p>{t("Notes","ملاحظات")}: {order.notes}</p>}<p>{t("Internal purchase document. Tax, supplier payments and payables are not recorded on this document.","مستند شراء داخلي. الضرائب ومدفوعات المورد والذمم غير مسجّلة في هذا المستند.")}</p></section></main>;
}
