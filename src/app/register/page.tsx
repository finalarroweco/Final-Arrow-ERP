import { RegistrationForm } from "./form";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";

export default async function Register() {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /></header>
    <section className="hero"><p>{t("GET STARTED", "ابدأ الآن")}</p><h1>{t("Create your workspace.", "أنشئ مساحة عملك.")}</h1><RegistrationForm locale={locale} /></section>
  </main>;
}
