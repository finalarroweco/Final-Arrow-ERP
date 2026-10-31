import {redirect,notFound} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {db} from "@/lib/db";
import {projectBillingReport} from "@/lib/project-billing";
import {OperationalError} from "@/lib/operational-records";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../language-switcher";
import {BillingWorkspace} from "./workspace";
export default async function BillingPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();const source=await db.project.findUnique({where:{id},select:{tenantId:true}});if(!source)notFound();let report;try{report=await projectBillingReport(actor.id,source.tenantId,id);}catch(e){if(e instanceof OperationalError&&[403,404].includes(e.status))notFound();throw e;}
 const {project,summary,rows,nextPage}=report,locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),canManage=await canAccess({userId:actor.id,tenantId:project.tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission:"project-billing:manage"});
 return <main><style>{`@media print{header,form,button,.billing-controls{display:none!important}.hero{padding:20px 0!important}.hero h1{font-size:28px!important}.panel{border:0!important;box-shadow:none!important}}`}</style><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/projects">{t("Projects","المشاريع")}</a></header><section className="hero"><p>{t("PROJECT INVOICE TRACKING","متابعة فواتير المشروع")}</p><h1>{project.name}</h1><p>{project.code}</p></section><BillingWorkspace actorId={actor.id} project={project} initial={{summary,rows,nextPage}} canManage={canManage} locale={locale}/></main>;
}
