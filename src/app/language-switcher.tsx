"use client";

import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/locale";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  function switchLanguage() {
    const next = locale === "ar" ? "en" : "ar";
    document.cookie = `fa_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }
  return <button type="button" className="language-switcher" onClick={switchLanguage}
    aria-label={locale === "ar" ? "Switch to English" : "التبديل إلى العربية"}
    lang={locale === "ar" ? "en" : "ar"}>{locale === "ar" ? "English" : "العربية"}</button>;
}
