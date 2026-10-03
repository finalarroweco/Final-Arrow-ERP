import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "./print";
export default async function Receipt({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const order=await db.posOrder.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},lines:{orderBy:{position:"asc"}}}});
 if(!order||!(await canAccess({userId:actor.id,tenantId:order.tenantId,companyId:order.companyId,branchId:order.branchId,permission:"pos:read"})))notFound();
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}}`}</style><header className="no-print"><a href="/pos">{t("Back to POS","العودة لنقاط البيع")}</a><PrintReceipt label={t("Print receipt","طباعة الإيصال")}/></header><section className="panel"><h1>{order.company.name}</h1><p>{order.branch.name} · {order.number}</p><p>{t("Internal order receipt","إيصال طلب داخلي")} · {t(order.status,{OPEN:"مفتوح",PAID:"مدفوع",CANCELLED:"ملغى"}[order.status])}</p><p>{t(order.type,order.type==="DINE_IN"?"داخل المطعم":"سفري")} · {order.tableLabel}</p><p>{order.createdAt.toISOString().replace("T"," ").slice(0,16)} UTC</p><table><thead><tr><th>{t("Item","الصنف")}</th><th>{t("Quantity","الكمية")}</th><th>{t("Price","السعر")}</th><th>{t("Amount","المبلغ")}</th></tr></thead><tbody>{order.lines.map(line=><tr key={line.id}><td>{line.itemName}</td><td>{line.quantity}</td><td>{line.unitPrice.toFixed(3)}</td><td>{line.amount.toFixed(3)}</td></tr>)}</tbody></table><h2>{t("Total","الإجمالي")}: {order.total.toFixed(3)} {order.currency}</h2>{order.note&&<p>{order.note}</p>}{order.paymentMethod&&<p>{t("Payment method","طريقة الدفع")}: {t(order.paymentMethod,order.paymentMethod==="CASH"?"نقدي":"بطاقة")}</p>}{order.paymentReference&&<p>{t("Reference","المرجع")}: {order.paymentReference}</p>}{order.tendered&&<p>{t("Cash received","النقد المستلم")}: {order.tendered.toFixed(3)} · {t("Change","الباقي")}: {order.change?.toFixed(3)}</p>}{order.cancelReason&&<p>{t("Cancellation reason","سبب الإلغاء")}: {order.cancelReason}</p>}<p>{t("Manual payment record. Tax is not calculated. This is an internal receipt.","سجل دفع يدوي. الضرائب غير محسوبة. هذا إيصال داخلي.")}</p></section></main>;
}
