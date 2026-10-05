import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {readableCompanyPermissions} from "@/lib/access";
import {receiptRegister,ReceiptRegisterError} from "@/lib/receipt-register";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
export default async function ReceiptRegisterPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:"ACTIVE"},include:{tenant:{include:{companies:{include:{branches:true},orderBy:{name:"asc"}}}}}});
 const scopes=(await Promise.all(memberships.flatMap(({tenant})=>tenant.companies.map(async company=>{
  const rights=await readableCompanyPermissions({userId:actor.id,tenantId:tenant.id,companyId:company.id,permissions:["purchase-order:read","inventory-stock:read"]});
  const stock=rights["inventory-stock:read"];if(stock===false||rights["purchase-order:read"]===false)return null;
  return {tenantId:tenant.id,companyId:company.id,value:`${tenant.id}:${company.id}`,label:`${tenant.name} / ${company.name}`,branches:company.branches.filter(b=>stock===null||stock.includes(b.id))};
 })))).filter(s=>s!==null);
 const query=await searchParams,scope=scopes.find(s=>s.value===query.scope)??(query.scope?undefined:scopes[0]);
 const q=typeof query.q==="string"?query.q:"",branchId=typeof query.branchId==="string"&&query.branchId?query.branchId:undefined;
 let result:Awaited<ReturnType<typeof receiptRegister>>|undefined,error="";
 if(scope)try{if(Object.values(query).some(v=>Array.isArray(v)))throw new ReceiptRegisterError("Duplicate filters",400);result=await receiptRegister(actor.id,{tenantId:scope.tenantId,companyId:scope.companyId,q,...(branchId?{branchId}:{}),...(query.page?{page:query.page}:{})});}
 catch(e){if(e instanceof ReceiptRegisterError)error=t("Invalid or unavailable receipt filters. Reset the search.","فلاتر الاستلام غير صالحة أو غير متاحة. أعد ضبط البحث.");else throw e;}
 const pageLink=(page:number)=>`/purchasing/receipts?${new URLSearchParams({scope:scope!.value,q,...(branchId?{branchId}:{}),page:String(page)})}`;
 return <main><style>{`.receipt-register-table{width:100%;min-width:700px;border-collapse:collapse;font-size:.9rem}.receipt-register-table th,.receipt-register-table td{padding:12px;text-align:start;border-bottom:1px solid #e5e5e5}.receipt-register-table th{white-space:nowrap}`}</style><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/purchasing/orders">{t("Purchase orders","أوامر الشراء")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header>
 <section className="hero"><p>{t("PURCHASING","المشتريات")}</p><h1>{t("Goods receipts.","سجل استلام البضائع.")}</h1><p className="sub">{t("Find saved receipts and open their print and CSV documents.","ابحث في الاستلامات المحفوظة وافتح مستنداتها للطباعة والتصدير.")}</p></section>
 <section className="panel">{!scopes.length?<p>{t("No accessible receipts.","لا توجد استلامات متاحة.")}</p>:<><form method="get"><label>{t("Company","الشركة")} <select name="scope" defaultValue={scope?.value??""}><option value="">{t("Select company","اختر الشركة")}</option>{scopes.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
 <label>{t("Supplier, order or receipt ID","المورد أو أمر الشراء أو مرجع الاستلام")} <input name="q" maxLength={120} defaultValue={q}/></label>
 <label>{t("Receiving branch","فرع الاستلام")} <select name="branchId" defaultValue={branchId??""}><option value="">{t("All accessible branches","كل الفروع المتاحة")}</option>{scope?.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
 <button>{t("Search","بحث")}</button><a href="/purchasing/receipts">{t("Reset","إعادة ضبط")}</a></form>
 {!scope&&<p role="alert">{t("Choose an accessible company.","اختر شركة متاحة.")}</p>}{error&&<p role="alert">{error}</p>}
 {result&&<><p>{t("Original receipts remain available after stock corrections. This register does not show net inventory, supplier credits or financial valuation.","تبقى مستندات الاستلام الأصلية متاحة بعد تصحيح المخزون. لا يعرض هذا السجل صافي المخزون أو إشعارات المورد أو التقييم المالي.")}</p>
 <div style={{overflowX:"auto"}}><table className="receipt-register-table"><thead><tr>{[t("Order","أمر الشراء"),t("Supplier","المورد"),t("Branch","الفرع"),t("Received at (UTC)","تاريخ الاستلام (UTC)"),t("Lines","البنود"),t("Corrected stock lines","بنود مخزون معكوسة"),t("Document","المستند")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{result.receipts.map(r=><tr key={r.id}><td>{r.order.number}</td><td>{r.order.supplierName}</td><td>{r.branch.name}</td><td>{r.createdAt.toISOString().slice(0,16).replace("T"," ")}</td><td>{r._count.lines}</td><td>{r.correctedLineCount} / {r._count.lines}</td><td><a href={`/purchasing/receipts/${r.id}`}>{t("View / print","عرض / طباعة")}</a> · <a href={`/api/purchase-orders/receipts/${r.id}?format=csv`}>CSV</a></td></tr>)}</tbody></table></div>
 {!result.receipts.length&&<p>{t("No matching receipts.","لا توجد استلامات مطابقة.")}</p>}{result.page>0&&<a href={pageLink(result.page-1)}>{t("Previous","السابق")}</a>}{result.nextPage!==null&&<a href={pageLink(result.nextPage)}>{t("Next","التالي")}</a>}</>}
 </>}</section></main>;
}
