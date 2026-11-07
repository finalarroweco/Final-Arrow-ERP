import {invoiceGross} from "@/lib/invoice-vat";
import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {settlementInvoice,customerSettlementAllowed} from "@/lib/customer-settlement";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../../language-switcher";
import {CustomerSettlementForm} from "./form";
export default async function InvoiceSettlementsPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const row=await db.invoice.findUnique({where:{id},select:{tenantId:true}});if(!row)notFound();
 const invoice=await settlementInvoice(db,row.tenantId,id);if(!invoice||!(await customerSettlementAllowed(actor.id,invoice)))notFound();
 const canPost=await customerSettlementAllowed(actor.id,invoice,true),locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/accounting/invoices">{t("Invoices","الفواتير")}</a><a href={`/accounting/invoices/${id}`}>{t("Invoice / print","الفاتورة / الطباعة")}</a><a href="/accounting/ledger">{t("Ledger","دفتر الأستاذ")}</a></header><section className="hero"><p>{t("ACCOUNTING / COLLECTIONS","المحاسبة / التحصيلات")}</p><h1>{t("Invoice collections.","تحصيلات الفاتورة.")}</h1><p className="sub">{invoice.number} · {invoice.customerName} · {invoiceGross(invoice).toFixed(3)} {invoice.currency}</p></section><CustomerSettlementForm key={id} tenantId={invoice.tenantId} companyId={invoice.companyId} invoiceId={id} canPost={canPost} locale={locale}/></main>;
}
