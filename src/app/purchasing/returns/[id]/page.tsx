import {DocumentPosting} from "../../../accounting/document-posting";
import {db} from "@/lib/db";
import {canAccess} from "@/lib/access";
import {purchaseDocument} from "@/lib/purchase-ledger";
import {notFound,redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {readableGoodsReturn} from "@/lib/goods-return";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {PrintReceipt} from "../../../pos/[id]/print";
import {LanguageSwitcher} from "../../../language-switcher";
export default async function GoodsReturnDocument({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params,document=await readableGoodsReturn(actor.id,id);if(!document)notFound();
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),receipt=document.receipt;
 const scope={userId:actor.id,tenantId:document.tenantId,companyId:receipt.companyId,branchId:receipt.branchId};
 const rights=await Promise.all([canAccess({...scope,permission:"ledger:read"}),canAccess({...scope,permission:"ledger:post"})]);
 const financial=rights[0]?await purchaseDocument(db,"purchase-return",document.tenantId,id):null;
 return <main><style>{`@media print{.no-print{display:none!important}main{padding:0!important}.panel{border:0!important;box-shadow:none!important}tr{break-inside:avoid}thead{display:table-header-group}}`}</style>
 <header className="no-print"><a href="/purchasing/returns">{t("Stock returns","مرتجعات المخزون")}</a><LanguageSwitcher locale={locale}/><PrintReceipt label={t("Print / save PDF","طباعة / حفظ PDF")}/></header>
 <section className="panel"><h1>{receipt.company.name}</h1><h2>{t("Stock return document","مستند مرتجع مخزون")}</h2><p>{t("Return reference","مرجع المرتجع")}: {document.id}</p><p>{t("Original receipt","الاستلام الأصلي")}: <a href={`/purchasing/receipts/${receipt.id}`}>{receipt.id}</a></p><p>{t("Purchase order","أمر الشراء")}: <a href={`/purchasing/orders/${receipt.order.id}`}>{receipt.order.number}</a></p><p>{t("Supplier","المورد")}: {receipt.order.supplierName}</p><p>{t("Branch","الفرع")}: {receipt.branch.name}</p><p>{t("Returned at (UTC)","تاريخ الإرجاع (UTC)")}: {document.createdAt.toISOString().slice(0,16).replace("T"," ")}</p><p>{t("Reason","السبب")}: {document.reason}</p>
 <table><thead><tr>{[t("Order line","بند أمر الشراء"),t("SKU","رمز الصنف"),t("Item","الصنف"),t("Unit","الوحدة"),t("Returned quantity","الكمية المرتجعة")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{document.lines.map(line=><tr key={line.id}><td>{line.receiptLine.orderLine.description}</td><td>{line.receiptLine.item.sku}</td><td>{line.receiptLine.item.name}</td><td>{line.receiptLine.item.unit}</td><td>{line.quantity}</td></tr>)}</tbody></table>
 <p>{t("Stock quantities are deducted and this document is saved in the stock ledger. Original receipt and purchase fulfilment remain recorded. This document does not create a supplier credit, refund, tax adjustment or financial valuation. Item names and units use the current catalog.","تم خصم الكميات وحفظ المستند في سجل المخزون. يبقى الاستلام الأصلي وتنفيذ أمر الشراء محفوظين. لا ينشئ هذا المستند إشعار دائن للمورد أو استردادًا ماليًا أو تعديل ضريبة أو تقييمًا ماليًا. أسماء الأصناف والوحدات من الدليل الحالي.")}</p></section>{financial&&<section className="panel no-print"><h2>{t("Purchase return credit","قيد إشعار مرتجع المشتريات")}</h2><DocumentPosting kind="purchase-return" id={id} scope={{tenantId:document.tenantId,companyId:receipt.companyId}} locale={locale} amount={financial.amount.toFixed(3)} currency={financial.currency} eligible={financial.eligible&&financial.amount.gt(0)} canPost={rights[1]}/></section>}</main>;
}
