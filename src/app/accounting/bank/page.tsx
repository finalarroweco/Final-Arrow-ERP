import {redirect} from "next/navigation";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankAllowed} from "@/lib/bank-reconciliation";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
import {BankWorkspace} from "./workspace";
export default async function BankPage(){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:"ACTIVE"},include:{tenant:{include:{companies:{orderBy:{name:"asc"}}}}}});
 const options=(await Promise.all(memberships.flatMap(({tenant})=>tenant.companies.map(async company=>await bankAllowed(actor.id,tenant.id,company.id)?{tenantId:tenant.id,companyId:company.id,label:`${tenant.name} / ${company.name}`,currency:company.baseCurrency,canPost:await bankAllowed(actor.id,tenant.id,company.id,true)}:null)))).filter(o=>o!==null);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/accounting/ledger">{t("Ledger","دفتر الأستاذ")}</a><a href="/dashboard">{t("Dashboard","لوحة التحكم")}</a></header><section className="hero"><p>{t("ACCOUNTING / BANK","المحاسبة / البنك")}</p><h1>{t("Bank reconciliation.","التسويات البنكية.")}</h1><p className="sub">{t("Import a statement, match actual movements and review the balance difference.","استورد الكشف، وطابق الحركات الفعلية، وراجع فرق الرصيد.")}</p></section><BankWorkspace options={options} locale={locale}/></main>;
}
