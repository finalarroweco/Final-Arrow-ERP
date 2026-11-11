import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {getLocale} from "@/lib/server-locale";
import {LanguageSwitcher} from "../../../../language-switcher";
import {CertificateDetail} from "./detail";
export default async function CertificatePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id:rawId}=await params,query=await searchParams,{tenantId:rawTenantId}=query;
 const guard=z.object({tenantId:z.string(),expectedActorId:z.string().uuid().transform(value=>value.toLowerCase()).optional()}).strict().safeParse(query);if(!guard.success||(guard.data.expectedActorId&&guard.data.expectedActorId!==actor.id))notFound();
 const parsedId=z.string().uuid().safeParse(rawId),parsedTenant=z.string().uuid().safeParse(rawTenantId);if(!parsedId.success||!parsedTenant.success)notFound();const id=parsedId.data.toLowerCase(),tenantId=parsedTenant.data.toLowerCase();
 const locale=await getLocale();return <main><header className="no-print"><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/></header><CertificateDetail key={`${actor.id}:${tenantId}:${id}`} actorId={actor.id} tenantId={tenantId!} id={id} locale={locale}/></main>;
}
