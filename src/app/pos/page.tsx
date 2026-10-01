import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../language-switcher";
import {PosWorkspace} from "./workspace";
export default async function PosPage(){
 const user=await currentUser();if(!user)redirect("/login");const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:user.id,status:"ACTIVE"},include:{tenant:{include:{companies:{include:{branches:true}}}}}});
 const options=(await Promise.all(memberships.flatMap(({tenant})=>tenant.companies.flatMap((company)=>company.branches.map(async(branch)=>{
 const scope={userId:user.id,tenantId:tenant.id,companyId:company.id,branchId:branch.id};if(!(await canAccess({...scope,permission:"pos:read"})))return null;
 return {tenantId:tenant.id,companyId:company.id,branchId:branch.id,label:`${tenant.name} / ${company.name} / ${branch.name}`,currency:company.baseCurrency,canManage:await canAccess({...scope,permission:"pos:manage"}),canManageShared:await canAccess({userId:user.id,tenantId:tenant.id,companyId:company.id,permission:"pos:manage"})};
 }))))).filter((option)=>option!==null);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><p>{t("POINT OF SALE","نقاط البيع")}</p><h1>{t("Restaurant orders.","طلبات المطعم.")}</h1><p className="sub">{t("Menu, dine-in and takeaway orders, payment records and receipts.","القائمة وطلبات الطاولات والسفري وتسجيل الدفع والإيصالات.")}</p></section><PosWorkspace options={options} locale={locale}/></main>;
}
