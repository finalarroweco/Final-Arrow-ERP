import {notFound,redirect} from "next/navigation";
import {z} from "zod";
import {currentUser} from "@/lib/auth";
import {getLocale} from "@/lib/server-locale";
import {LanguageSwitcher} from "../../../../language-switcher";
import {CertificateDetail} from "./detail";
export default async function CertificatePage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{tenantId?:string}>}){
 const actor=await currentUser();if(!actor)redirect("/login");const {id:rawId}=await params,{tenantId:rawTenantId}=await searchParams;
 const parsedId=z.string().uuid().safeParse(rawId),parsedTenant=z.string().uuid().safeParse(rawTenantId);if(!parsedId.success||!parsedTenant.success)notFound();const id=parsedId.data.toLowerCase(),tenantId=parsedTenant.data.toLowerCase();
 const locale=await getLocale();return <main><header className="no-print"><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/></header><CertificateDetail key={`${actor.id}:${tenantId}:${id}`} actorId={actor.id} tenantId={tenantId!} id={id} locale={locale}/></main>;
}
