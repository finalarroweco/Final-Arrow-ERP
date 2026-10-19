import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
import {RolesPanel} from "./panel";
export default async function RolesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const memberships=await db.membership.findMany({where:{userId:actor.id,status:"ACTIVE",roleGrants:{some:{role:{name:"Owner"},scopes:{some:{type:"TENANT"}}}}},select:{tenant:{select:{id:true,name:true,companies:{select:{id:true,name:true,branches:{select:{id:true,name:true},orderBy:{name:"asc"}}},orderBy:{name:"asc"}}}}}});
 const tenants=memberships.map(m=>m.tenant),query=await searchParams,tenant=tenants.find(t=>t.id===query.tenantId)??(!query.tenantId?tenants[0]:undefined);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/workspace">{t("Workspace","مساحة العمل")}</a><a href="/audit">{t("Activity history","سجل العمليات")}</a></header><section className="hero"><p>{t("ORGANIZATION ACCESS","صلاحيات المؤسسة")}</p><h1>{t("Roles and permissions.","الأدوار والصلاحيات.")}</h1><p className="sub">{t("Create operational roles and assign access by company and branch.","أنشئ أدوار العمل وحدد الوصول حسب الشركة والفرع.")}</p></section>
 <section className="panel"><p>{t("Only organization owners can edit roles and assignments. Built-in roles and owner access are protected. Updating a custom role affects all members using it. Account administration is reserved for owners.","مالك المؤسسة فقط يستطيع تعديل الأدوار والإسناد. الأدوار الأساسية وصلاحيات المالك محمية. تعديل الدور المخصّص يطبّق على جميع الأعضاء المرتبطين به. إدارة الحسابات محصورة بالمالك.")}</p>{!tenants.length?<p>{t("Organization owner access is required.","يلزم حساب مالك المؤسسة.")}</p>:<form method="get"><label>{t("Organization","المؤسسة")}<select name="tenantId" defaultValue={tenant?.id??""}>{tenants.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button>{t("Select organization","اختيار المؤسسة")}</button></form>}</section>
 {tenant?<RolesPanel key={tenant.id} tenantId={tenant.id} currentUserId={actor.id} companies={tenant.companies} locale={locale}/>:tenants.length>0&&<p role="alert">{t("Organization unavailable.","المؤسسة غير متاحة.")}</p>}</main>;
}
