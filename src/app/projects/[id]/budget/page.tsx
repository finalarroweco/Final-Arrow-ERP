import {redirect,notFound} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {canAccess} from "@/lib/access";
import {budgetReport} from "@/lib/project-budget";
import {OperationalError} from "@/lib/operational-records";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../language-switcher";
import {BudgetWorkspace} from "./workspace";
import {db} from "@/lib/db";
export default async function BudgetPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id}=await params;if(!z.string().uuid().safeParse(id).success)notFound();
 const source=await db.project.findUnique({where:{id},select:{tenantId:true}});if(!source)notFound();
 let report;try{report=await budgetReport(actor.id,source.tenantId,id);}catch(e){if(e instanceof OperationalError&&[403,404].includes(e.status))notFound();throw e;}
 const {project,summary,events,nextPage}=report,locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const canManage=await canAccess({userId:actor.id,tenantId:project.tenantId,companyId:project.companyId,branchId:project.branchId??undefined,permission:"project-budget:manage"});
 return <main><style>{`@media print{header,form,button,.budget-controls{display:none!important}.hero{padding:20px 0!important}.hero h1{font-size:28px!important}.panel{border:0!important;box-shadow:none!important}}`}</style><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/projects">{t("Projects","المشاريع")}</a></header><section className="hero"><p>{t("PROJECT BUDGET","ميزانية المشروع")}</p><h1>{project.name}</h1><p>{project.code} · {t("Budget and recorded actual costs","الميزانية والتكاليف الفعلية المسجّلة")}</p></section><BudgetWorkspace actorId={actor.id} project={{id,tenantId:project.tenantId,status:project.status}} initial={{summary,events,nextPage}} canManage={canManage} locale={locale}/></main>;
}
