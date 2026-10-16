import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {operationalParent,OperationalError,uuid} from "@/lib/operational-records";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../language-switcher";
import {Contacts,TicketMessages} from "./records";
export type RecordQuery=Promise<Record<string,string|string[]|undefined>>;
export async function OperationalRecordPage({kind,searchParams}:{kind:"customer"|"ticket";searchParams:RecordQuery}){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),query=await searchParams;
 const tenantId=typeof query.tenantId==="string"?query.tenantId:"",id=typeof query.id==="string"?query.id:"";
 let parent:Awaited<ReturnType<typeof operationalParent>>|undefined,error="";
 if(tenantId||id)try{if(Object.values(query).some(v=>Array.isArray(v))||!uuid.safeParse(tenantId).success||!uuid.safeParse(id).success)throw new OperationalError("Invalid source",400);parent=await operationalParent(kind,id,tenantId,actor.id);}catch(e){if(e instanceof OperationalError)error=t("Source unavailable or outside your permissions.","المستند غير متاح أو خارج صلاحياتك.");else throw e;}
 const manage=parent?await canAccess({userId:actor.id,tenantId,companyId:parent.companyId,branchId:parent.branchId??undefined,permission:kind==="customer"?"customer:update":"ticket:manage"}):false;
 const writable=manage&&parent&&(kind==="customer"?("archivedAt" in parent&&!parent.archivedAt):("status" in parent&&parent.status!=="CLOSED"));
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href={kind==="customer"?"/crm":"/helpdesk"}>{kind==="customer"?t("Customers","العملاء"):t("Helpdesk","الدعم الفني")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><h1>{kind==="customer"?t("Customer contacts.","جهات اتصال العملاء."):t("Internal ticket follow-up.","المتابعة الداخلية للتذاكر.")}</h1><p>{kind==="customer"?t("Multiple named contacts per customer, with searchable contact details and archived history.","جهات اتصال متعددة لكل عميل، مع البحث في بيانات التواصل وحفظ الأرشيف."):t("Internal notes for your authorized team. Nothing is sent to the customer or external channels. Notes are permanent; add a new note to correct earlier information.","ملاحظات داخلية للفريق المخوّل. لا تُرسل للعميل أو القنوات الخارجية. تبقى الملاحظات محفوظة؛ أضف ملاحظة جديدة لتصحيح معلومة سابقة.")}</p></section><section className="panel">
 {error&&<p role="alert">{error}</p>}{parent?<><h2>{"displayName" in parent?parent.displayName:parent.subject}</h2>{!writable&&<p>{t("Read-only: check source status and management permissions.","للعرض فقط: تحقق من حالة المستند وصلاحية الإدارة.")}</p>}{kind==="customer"?<Contacts key={tenantId+id} tenantId={tenantId} id={id} locale={locale} writable={Boolean(writable)}/>:<TicketMessages key={tenantId+id} tenantId={tenantId} id={id} locale={locale} writable={Boolean(writable)}/>}</>:<p>{kind==="customer"?t("Open a customer's Contacts link from the customer register.","افتح رابط جهات الاتصال الخاص بالعميل من سجل العملاء."):t("Open Internal follow-up from a ticket in the helpdesk.","افتح المتابعة الداخلية من التذكرة في قسم الدعم الفني.")}</p>}</section></main>;
}
