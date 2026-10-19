import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {dependencyProject} from "@/lib/task-dependency";
import {uuid,OperationalError} from "@/lib/operational-records";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../language-switcher";
import {Dependencies} from "./workspace";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),{id}=await params,query=await searchParams,tenantId=typeof query.tenantId==="string"?query.tenantId:"";let project:Awaited<ReturnType<typeof dependencyProject>>|undefined,error="";
 try{if(!uuid.safeParse(tenantId).success||Object.values(query).some(v=>Array.isArray(v)))throw new OperationalError("Invalid project",400);project=await dependencyProject(id,tenantId,actor.id);}catch(e){if(e instanceof OperationalError)error=t("Project unavailable or outside your task permissions.","المشروع غير متاح أو خارج صلاحيات المهام لديك.");else throw e;}
 const canManage=project?await canAccess({userId:actor.id,tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission:"project-task:manage"}):false;
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/projects">{t("Projects","المشاريع")}</a><a href="/release-status">{t("Delivery status","حالة التطوير")}</a></header><section className="hero"><h1>{t("Task dependencies.","اعتماديات المهام.")}</h1><p>{t("A task can depend on several prerequisites. Every active prerequisite must be DONE before the task can start or complete. Cancelled prerequisites remain blocking until their link is removed. Cycles are rejected.","يمكن ربط المهمة بعدة متطلبات سابقة. يجب إكمال كل متطلب نشط قبل بدء المهمة أو إتمامها. يبقى المتطلب الملغى مانعًا حتى إزالة رابطه. يُرفض الربط الدائري.")}</p></section><section className="panel">{error&&<p role="alert">{error}</p>}{project&&<><h2>{project.name}</h2><p>{t("Links can be added or removed only while the dependent task is TODO and its project is planned or active. Removed links remain in history. Limits: 5000 active links and 10000 links including history per project.","تُضاف الروابط وتُزال فقط قبل بدء المهمة التابعة وعندما يكون المشروع مخططًا أو نشطًا. تبقى الروابط المُزالة في السجل. الحد: ٥٠٠٠ رابط نشط و١٠٠٠٠ رابط مع السجل لكل مشروع.")}</p><Dependencies key={tenantId+id} tenantId={tenantId} id={id} locale={locale} writable={canManage&&["PLANNED","ACTIVE"].includes(project.status)}/></>}</section></main>;
}
