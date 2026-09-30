import { LoginForm } from "./form";
import { getLocale } from "@/lib/server-locale";
import { translate } from "@/lib/locale";
import { LanguageSwitcher } from "../language-switcher";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const locale = await getLocale();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const { next } = await searchParams;
  const destination = next?.startsWith("/invite/") && !next.startsWith("//") ? next : "/workspace";
  return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale} /></header>
    <section className="hero"><p>{t("WELCOME BACK", "أهلاً بعودتك")}</p><h1>{t("Sign in.", "تسجيل الدخول.")}</h1><LoginForm destination={destination} locale={locale} /></section>
  </main>;
}
