import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {db} from "@/lib/db";
import {currentUser} from "@/lib/auth";
import {bankTenantLock,requireBankAccess} from "@/lib/bank-allocation";
import {bankAllowed,reconciliation,BankError} from "@/lib/bank-reconciliation";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../../language-switcher";
import {certificateAllowed} from "@/lib/bank-certificates";
import {CertificateWidget} from "../certificates/widget";
import {ReconciliationPanel} from "./panel";
export default async function ReconciliationPage({params}:{params:Promise<{id:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id:rawId}=await params,parsedId=z.string().uuid().safeParse(rawId);if(!parsedId.success)notFound();const id=parsedId.data.toLowerCase();
 const row=await db.bankStatement.findUnique({where:{id},select:{tenantId:true,companyId:true}});if(!row||!(await bankAllowed(actor.id,row.tenantId,row.companyId)))notFound();
 const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar),canPost=await bankAllowed(actor.id,row.tenantId,row.companyId,true),canCreate=await certificateAllowed(actor.id,row.tenantId,row.companyId,"create");
 let result:Awaited<ReturnType<typeof reconciliation>>|undefined,error="";try{result=await db.$transaction(async tx=>{await bankTenantLock(tx,row.tenantId);await requireBankAccess(tx,actor.id,row.tenantId,row.companyId);return reconciliation(tx,id,row.tenantId);},{isolationLevel:"ReadCommitted",timeout:15000,maxWait:10000});}catch(e){if(e instanceof BankError)error=e.message;else throw e;}
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/accounting/bank">{t("Bank statements","كشوف البنك")}</a><a href="/accounting/ledger">{t("Ledger / record an adjustment","دفتر الأستاذ / تسجيل تسوية")}</a></header><section className="hero"><p>{t("ACCOUNTING / BANK","المحاسبة / البنك")}</p><h1>{t("Match and review.","المطابقة والمراجعة.")}</h1><p className="sub">{t("A live workbench based on imported statements and current journal matches.","مراجعة مباشرة مبنية على الكشوف المستوردة ومطابقات القيود الحالية.")}</p></section>{error?<section className="panel"><p role="alert">{error}</p></section>:result&&<ReconciliationPanel key={`${actor.id}:${id}`} actorId={actor.id} tenantId={row.tenantId} id={id} initial={JSON.parse(JSON.stringify(result))} locale={locale} canPost={canPost}/>}<CertificateWidget key={`${actor.id}:${row.tenantId}:${id}`} actorId={actor.id} tenantId={row.tenantId} statementId={id} locale={locale} canCreate={canCreate}/></main>;
}
