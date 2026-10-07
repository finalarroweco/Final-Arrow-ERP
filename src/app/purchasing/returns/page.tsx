import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {readableCompanyPermissions} from "@/lib/access";
import {returnRegister,ReturnRegisterError} from "@/lib/return-register";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
export default async function ReturnRegisterPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:"ACTIVE"},include:{tenant:{include:{companies:{orderBy:{name:"asc"}}}}}});
 const scopes=(await Promise.all(memberships.flatMap(({tenant})=>tenant.companies.map(async company=>{
  const rights=await readableCompanyPermissions({userId:actor.id,tenantId:tenant.id,companyId:company.id,permissions:["purchase-order:read","inventory-stock:read"]});
  return rights["purchase-order:read"]===false||rights["inventory-stock:read"]===false?null:{tenantId:tenant.id,companyId:company.id,value:`${tenant.id}:${company.id}`,label:`${tenant.name} / ${company.name}`};
 })))).filter(s=>s!==null);
 const query=await searchParams,scope=scopes.find(s=>s.value===query.scope)??(query.scope?undefined:scopes[0]),q=typeof query.q==="string"?query.q:"";
 let result:Awaited<ReturnType<typeof returnRegister>>|undefined,error="";
 if(scope)try{
  if(Object.values(query).some(v=>Array.isArray(v)))throw new ReturnRegisterError("Duplicate filter",400);
  result=await returnRegister(actor.id,{tenantId:scope.tenantId,companyId:scope.companyId,q,...(query.page?{page:query.page}:{})});
 }catch(e){if(e instanceof ReturnRegisterError)error=t("Invalid or unavailable filters. Reset the search.","الفلاتر غير صالحة أو غير متاحة. أعد ضبط البحث.");else throw e;}
 const financialStatus=(status:string)=>t(({no_access:"—",posted:"Posted",reversed:"Reversed",unposted:"Unposted",source_unposted:"Post receipt first",source_reversed:"Original journal reversed"} as Record<string,string>)[status],({no_access:"—",posted:"مرحّل",reversed:"معكوس",unposted:"غير مرحّل",source_unposted:"رحّل الاستلام أولًا",source_reversed:"قيد الاستلام معكوس"} as Record<string,string>)[status]);
 const pageLink=(page:number)=>`/purchasing/returns?${new URLSearchParams({scope:scope!.value,q,page:String(page)})}`;
 return <main><style>{`.return-table{width:100%;min-width:700px;border-collapse:collapse}.return-table th,.return-table td{padding:12px;text-align:start;border-bottom:1px solid #e5e5e5}`}</style><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/purchasing/receipts">{t("Goods receipts","استلام البضائع")}</a><a href="/purchasing/orders">{t("Purchase orders","أوامر الشراء")}</a><a href="/purchasing/supplier-statement">{t("Supplier statement", "كشف حساب المورد")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header>
 <section className="hero"><p>{t("PURCHASING","المشتريات")}</p><h1>{t("Stock returns.","مرتجعات المخزون.")}</h1><p className="sub">{t("Return received goods with quantities and reasons saved in the stock ledger.","أرجع البضائع المستلمة مع حفظ الكميات والأسباب في سجل المخزون.")}</p></section>
 <section className="panel"><h2>{t("Create a return","إنشاء مرتجع")}</h2><p>{t("Open a saved goods receipt, choose the quantities to return and enter a reason. Returns deduct available stock from its receiving branch and preserve the original receipt.","افتح مستند استلام محفوظًا، وحدد كميات الإرجاع والسبب. تُخصم الكميات المتاحة من فرع الاستلام ويبقى المستند الأصلي محفوظًا.")}</p><a href="/purchasing/receipts">{t("Open goods receipts","فتح سجل الاستلام")}</a><p>{t("Post the original receipt journal first, then post the return credit from its document using the same accounts. Cash refunds, supplier payments, tax and freight need separate processing.","رحّل قيد الاستلام الأصلي أولًا، ثم رحّل إشعار المرتجع من مستنده على الحسابات نفسها. الاسترداد النقدي وسداد المورد والضرائب والشحن تحتاج معالجة منفصلة.")}</p></section>
 <section className="panel"><h2>{t("Saved returns","المرتجعات المحفوظة")}</h2>{!scopes.length?<p>{t("No accessible returns.","لا توجد مرتجعات متاحة.")}</p>:<><form method="get"><label>{t("Company","الشركة")}<select name="scope" defaultValue={scope?.value??""}>{scopes.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label><button>{t("Select company","اختيار الشركة")}</button></form>
 <form method="get"><input type="hidden" name="scope" value={scope?.value??""}/><label>{t("Order, supplier, reason or reference","أمر الشراء أو المورد أو السبب أو المرجع")}<input name="q" maxLength={120} defaultValue={q}/></label><button disabled={!scope}>{t("Search","بحث")}</button><a href="/purchasing/returns">{t("Reset","إعادة ضبط")}</a></form>{!scope&&<p role="alert">{t("Choose an accessible company.","اختر شركة متاحة.")}</p>}{error&&<p role="alert">{error}</p>}
 {result&&<><div style={{overflowX:"auto"}}><table className="return-table"><thead><tr>{[t("Order","أمر الشراء"),t("Supplier","المورد"),t("Branch","الفرع"),t("Returned at (UTC)","تاريخ الإرجاع (UTC)"),t("Reason","السبب"),t("Lines","البنود"),t("Accounting status","الحالة المحاسبية"),t("Document","المستند")].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{result.returns.map(r=><tr key={r.id}><td>{r.receipt.order.number}</td><td>{r.receipt.order.supplierName}</td><td>{r.receipt.branch.name}</td><td>{r.createdAt.toISOString().slice(0,16).replace("T"," ")}</td><td>{r.reason}</td><td>{r._count.lines}</td><td>{financialStatus(r.financialStatus)}{r.entry&&<> · <a href={`/accounting/ledger/journals/${r.entry.reversal?.id??r.entry.id}`}>{t("Journal","القيد")}</a></>}</td><td><a href={`/purchasing/returns/${r.id}`}>{t("View / print","عرض / طباعة")}</a></td></tr>)}</tbody></table></div>{!result.returns.length&&<p>{t("No matching stock returns.","لا توجد مرتجعات مخزون مطابقة.")}</p>}{result.page>0&&<a href={pageLink(result.page-1)}>{t("Previous","السابق")}</a>}{result.nextPage!==null&&<a href={pageLink(result.nextPage)}>{t("Next","التالي")}</a>}</>}
 </>}</section></main>;
}
