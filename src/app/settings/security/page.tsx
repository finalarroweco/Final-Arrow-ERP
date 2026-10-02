import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../../language-switcher";
import {SecurityForm} from "./form";
export default async function SecurityPage(){
 const actor=await currentUser();if(!actor)redirect("/login");const locale=await getLocale();const t=(en:string,ar:string)=>translate(locale,en,ar);
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><p>{t("ACCOUNT SECURITY","أمان الحساب")}</p><h1>{t("Change password.","تغيير كلمة المرور.")}</h1><p>{actor.name} · {actor.email}</p></section><SecurityForm locale={locale}/></main>;
}
