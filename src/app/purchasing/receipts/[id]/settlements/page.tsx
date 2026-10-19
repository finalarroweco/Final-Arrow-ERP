import {notFound,redirect} from "next/navigation";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {settlementReceipt,settlementAllowed} from "@/lib/supplier-settlement";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../../language-switcher";
import {SettlementForm} from "./form";
export default async function ReceiptSettlementsPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;
 const receipt=await db.goodsReceipt.findFirst({where:{id},select:{tenantId:true,order:{select:{number:true,supplierName:true}}}});if(!receipt)notFound();
 const source=await settlementReceipt(db,receipt.tenantId,id);if(!source||!(await settlementAllowed(actor.id,source)))notFound();
 const canPost=await settlementAllowed(actor.id,source,true),locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href={`/purchasing/receipts/${id}`}>{t("Goods receipt","استلام البضاعة")}</a><a href="/purchasing/settlements">{t("Supplier settlements","تسويات الموردين")}</a><a href="/accounting/ledger">{t("Ledger","دفتر الأستاذ")}</a></header><section className="hero"><p>{t("PURCHASING / ACCOUNTING","المشتريات / المحاسبة")}</p><h1>{t("Receipt settlement.","تسوية الاستلام.")}</h1><p className="sub">{receipt.order.number} · {receipt.order.supplierName}</p><p>{id}</p></section><SettlementForm tenantId={receipt.tenantId} companyId={source.companyId} receiptId={id} canPost={canPost} locale={locale}/></main>;
}
