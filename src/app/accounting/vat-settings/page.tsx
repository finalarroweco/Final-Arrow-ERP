import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {canAccess} from "@/lib/access";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
import {VatSettings} from "./workspace";
export default async function Page(){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:"ACTIVE"},include:{tenant:{include:{companies:{orderBy:{name:"asc"}}}}}});
 const options=(await Promise.all(memberships.flatMap(({tenant})=>tenant.companies.map(async c=>(await Promise.all([canAccess({userId:actor.id,tenantId:tenant.id,companyId:c.id,permission:"company:update"}),canAccess({userId:actor.id,tenantId:tenant.id,companyId:c.id,permission:"ledger:read"})])).every(Boolean)?{tenantId:tenant.id,companyId:c.id,label:`${tenant.name} / ${c.name}`,currency:c.baseCurrency}:null)))).filter(o=>o!==null);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/accounting/invoices">{t("Invoices","الفواتير")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><p>{t("ACCOUNTING","المحاسبة")}</p><h1>{t("Oman VAT settings.","إعدادات ضريبة عُمان.")}</h1><p className="sub">{t("For VAT-registered companies using OMR. Configure before creating invoices or posting purchase receipts or expenses.","للشركات المسجّلة في ضريبة القيمة المضافة بعملة الريال العُماني. اضبط الإعدادات قبل إنشاء الفواتير أو ترحيل استلام المشتريات أو المصاريف.")}</p></section><VatSettings options={options} locale={locale}/></main>;
}
