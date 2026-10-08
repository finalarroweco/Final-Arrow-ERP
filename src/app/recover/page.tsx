import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../language-switcher";
import {RecoveryForm} from "./form";
export const metadata={referrer:"no-referrer" as const};
export default async function RecoverPage(){const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/login">{t("Sign in","تسجيل الدخول")}</a></header><section className="hero"><p>{t("ACCOUNT RECOVERY","استعادة الحساب")}</p><h1>{t("Recover your account.","استعادة حسابك.")}</h1><p>{t("Use a backup code saved from Account security. If you have not created codes or have lost them, this method cannot recover your account. Email recovery is not configured yet.","استخدم رمزًا احتياطيًا حفظته من أمان الحساب. إذا لم تنشئ الرموز أو فقدتها، فلا يمكن الاستعادة بهذه الطريقة. الاستعادة عبر البريد غير مهيأة حاليًا.")}</p><RecoveryForm locale={locale}/></section></main>;}
