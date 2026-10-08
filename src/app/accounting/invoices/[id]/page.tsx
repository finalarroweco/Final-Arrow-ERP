import {settlementInvoice,customerSettlementAllowed,invoiceSettlementState} from "@/lib/customer-settlement";
import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../../../pos/[id]/print";
import {LanguageSwitcher} from "../../../language-switcher";
export default async function InvoiceDocument({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const invoice=await db.invoice.findUnique({where:{id},include:{company:{select:{name:true}},branch:{select:{name:true}},lines:{orderBy:{position:"asc"}}}});
 if(!invoice||!(await canAccess({userId:actor.id,tenantId:invoice.tenantId,companyId:invoice.companyId,branchId:invoice.branchId??undefined,permission:"invoice:read"})))notFound();
 const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const source=await settlementInvoice(db,invoice.tenantId,id);
 const settlement=source&&await customerSettlementAllowed(actor.id,source)?await db.$transaction(tx=>invoiceSettlementState(tx,source),{isolationLevel:"RepeatableRead",timeout:15000,maxWait:10000}):null;
 const stamp=(date:Date)=>`${date.toISOString().replace("T"," ").slice(0,16)} UTC`;
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style><header className="no-print"><a href="/accounting/invoices">{t("Back to invoices","العودة للفواتير")}</a><LanguageSwitcher locale={locale}/><a href={`/accounting/invoices/${id}/settlements`}>{t("Collections / refunds","التحصيلات / رد الدفعات")}</a><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header><section className="panel"><h1>{invoice.company.name}</h1><h2>{t("Internal invoice","فاتورة داخلية")}: {invoice.number}</h2><p><strong>{t(invoice.status,{DRAFT:"مسودة — لم تُصدر",ISSUED:"مصدرة",VOID:"ملغاة"}[invoice.status])}</strong></p><p>{t("Customer","العميل")}: {invoice.customerName}</p><p>{t("Branch","الفرع")}: {invoice.branch?.name??t("Company wide","على مستوى الشركة")}</p><p>{t("Created","تاريخ الإنشاء")}: {stamp(invoice.createdAt)}</p>{invoice.issuedAt&&<p>{t("Issued","تاريخ الإصدار")}: {stamp(invoice.issuedAt)}</p>}{invoice.voidedAt&&<p>{t("Voided","تاريخ الإلغاء")}: {stamp(invoice.voidedAt)} · {invoice.voidReason}</p>}<table><thead><tr><th>{t("Description","الوصف")}</th><th>{t("Quantity","الكمية")}</th><th>{t("Unit price","سعر الوحدة")}</th><th>{t("Amount","المبلغ")}</th></tr></thead><tbody>{invoice.lines.map(line=><tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{line.unitPrice.toFixed(3)}</td><td>{line.amount.toFixed(3)}</td></tr>)}</tbody></table><h2>{t("Subtotal","المجموع الفرعي")}: {invoice.subtotal.toFixed(3)} {invoice.currency}</h2>{invoice.notes&&<p>{t("Notes","ملاحظات")}: {invoice.notes}</p>}<p>{t("Internal document. Tax is not calculated.","مستند داخلي. الضرائب غير محسوبة.")}</p>{settlement?.original&&!settlement.original.reversed&&<p>{t("Net collected","صافي التحصيل")}: {settlement.collected.toFixed(3)} {invoice.currency} · {t("Outstanding balance","الرصيد المتبقي")}: {settlement.balance.toFixed(3)} {invoice.currency}</p>}</section></main>;
}
