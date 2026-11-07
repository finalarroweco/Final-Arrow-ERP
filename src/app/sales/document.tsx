import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../pos/[id]/print";
import {LanguageSwitcher} from "../language-switcher";
export async function SalesDocument({id,kind}:{id:string;kind:"quotes"|"orders"}){
 const actor=await currentUser();if(!actor)redirect("/login");if(!z.string().uuid().safeParse(id).success)notFound();
 const source=kind==="quotes"?await db.quote.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},customer:{select:{displayName:true}},lines:{orderBy:{position:"asc"}}}}):await db.salesOrder.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},lines:{orderBy:{position:"asc"}}}});
 if(!source||!(await canAccess({userId:actor.id,tenantId:source.tenantId,companyId:source.companyId,branchId:source.branchId??undefined,permission:kind==="quotes"?"quote:read":"order:read"})))notFound();
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const labels:Record<string,string>={DRAFT:"مسودة",SENT:"مرسل",ACCEPTED:"مقبول",REJECTED:"مرفوض",NEW:"جديد",IN_PROGRESS:"قيد التنفيذ",COMPLETED:"مكتمل",CANCELLED:"ملغى"};
 const stamp=(date:Date)=>`${date.toISOString().replace("T"," ").slice(0,16)} UTC`;
 const customerName="customer" in source?source.customer.displayName:source.customerName;
 const events="sentAt" in source?[[t("Marked sent","تحديد كمرسل"),source.sentAt],[t("Decision recorded","تسجيل القرار"),source.decidedAt]] as const:[[t("Started","بدء التنفيذ"),source.startedAt],[t("Completed","الإكمال"),source.completedAt],[t("Cancelled","الإلغاء"),source.cancelledAt]] as const;
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style><header className="no-print"><a href={`/sales/${kind}`}>{t("Back to sales","العودة للمبيعات")}</a><LanguageSwitcher locale={locale}/><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header><section className="panel"><h1>{source.company.name}</h1><h2>{kind==="quotes"?t("Quote","عرض سعر"):t("Sales order","طلب بيع")}: {source.number}</h2><p><strong>{t(source.status,labels[source.status])}</strong></p><p>{t("Customer","العميل")}: {customerName}</p><p>{t("Branch","الفرع")}: {source.branch?.name??t("Company wide","على مستوى الشركة")}</p><p>{t("Created","تاريخ الإنشاء")}: {stamp(source.createdAt)}</p>{events.map(([label,date])=>date&&<p key={label}>{label}: {stamp(date)}</p>)}<table><thead><tr><th>{t("Description","الوصف")}</th><th>{t("Quantity","الكمية")}</th><th>{t("Unit price","سعر الوحدة")}</th><th>{t("Amount","المبلغ")}</th></tr></thead><tbody>{source.lines.map(line=><tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{line.unitPrice.toFixed(3)}</td><td>{line.amount.toFixed(3)}</td></tr>)}</tbody></table><h2>{t("Subtotal","المجموع الفرعي")}: {source.subtotal.toFixed(3)} {source.currency}</h2>{source.notes&&<p>{t("Notes","ملاحظات")}: {source.notes}</p>}<p>{kind==="quotes"?t("Uses the current customer name. Marking a quote sent records its status; it does not deliver email.","يستخدم اسم العميل الحالي. تحديد العرض كمرسل يسجل الحالة ولا يرسل بريداً إلكترونياً."):t("Customer name and prices were saved when this order was created.","حُفظ اسم العميل والأسعار عند إنشاء طلب البيع.")}</p><p>{t("Internal sales document. Taxes and payment collection are not recorded here.","مستند مبيعات داخلي. الضرائب وتحصيل المدفوعات غير مسجّلة هنا.")}</p></section></main>;
}
