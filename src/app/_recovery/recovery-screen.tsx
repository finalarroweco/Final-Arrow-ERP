"use client";

import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { Locale } from "../../lib/locale";

// Error boundaries cannot depend on the server cookie reader or the root layout.
const subscribe = () => () => {};
function browserLocale(): Locale {
  try {
    const preference = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("fa_locale="));
    if (preference) return preference === "fa_locale=ar" ? "ar" : "en";
    return document.documentElement.lang === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}
export function useRecoveryLocale(): Locale {
  return useSyncExternalStore(subscribe, browserLocale, () => "en");
}

const action: CSSProperties = {
  display: "inline-block", padding: "12px 18px", borderRadius: 8,
  border: "1px solid #b80000", background: "#b80000", color: "#fff",
  font: "inherit", fontWeight: 700, lineHeight: 1.5, cursor: "pointer",
  textDecoration: "none", width: "auto", maxWidth: "100%", boxSizing: "border-box",
};

export function RecoveryScreen({ locale, kind, reset }: {
  locale: Locale;
  kind: "error" | "not-found";
  reset?: () => void;
}) {
  const ar = locale === "ar";
  const missing = kind === "not-found";
  return <main className="recovery-screen" lang={locale} dir={ar ? "rtl" : "ltr"}
    aria-labelledby="recovery-title"
    style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px", color: "#1b1b1d", fontFamily: "var(--font-tajawal, Tahoma), Arial, sans-serif", boxSizing: "border-box" }}>
    <style>{`.recovery-screen a:focus-visible,.recovery-screen button:focus-visible{outline:3px solid #174ea6;outline-offset:4px}.recovery-screen a:hover,.recovery-screen button:hover{text-decoration:underline}`}</style>
    <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 20px" }}>Final Arrow ERP{missing ? " · 404" : ""}</p>
    <h1 id="recovery-title" style={{ fontSize: "clamp(28px, 5vw, 42px)", lineHeight: 1.35, letterSpacing: 0, margin: "0 0 20px" }}>
      {missing ? (ar ? "الصفحة غير موجودة" : "Page not found") : (ar ? "تعذّر عرض الصفحة" : "Unable to display this page")}
    </h1>
    <p role={missing ? undefined : "alert"} style={{ fontSize: 17, lineHeight: 1.8, margin: "0 0 16px" }}>
      {missing
        ? (ar ? "قد يكون الرابط غير صحيح أو لم تعد الصفحة متاحة. تحقق من الرابط أو عد إلى لوحة التحكم." : "The link may be incorrect or the page may no longer be available. Check the address or return to your dashboard.")
        : (ar ? "حدث خطأ أثناء تحميل الصفحة. حاول مرة أخرى، أو عد إلى لوحة التحكم. إذا استمرت المشكلة، تواصل مع مسؤول النظام." : "Something went wrong while loading this page. Try again or return to your dashboard. If the problem continues, contact your administrator.")}
    </p>
    {!missing && <p style={{ fontSize: 15, lineHeight: 1.8, margin: "0 0 24px" }}>
      {ar ? "قد تُفقد التغييرات غير المحفوظة. إذا كنت تحفظ عملية، تحقق من سجلّها قبل إرسالها مرة أخرى لتجنّب التكرار." : "Unsaved changes may be lost. If you were saving a transaction, check its record before submitting it again to avoid duplicates."}
    </p>}
    <nav aria-label={ar ? "خيارات استعادة التصفح" : "Recovery options"} style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
      {reset && <button type="button" onClick={reset} style={action}>{ar ? "حاول مرة أخرى" : "Try again"}</button>}
      <a href="/dashboard" style={{ ...action, background: "#fff", color: "#b80000" }}>{ar ? "العودة إلى لوحة التحكم" : "Return to dashboard"}</a>
      <a href="/login" style={{ ...action, background: "#fff", color: "#b80000" }}>{ar ? "تسجيل الدخول" : "Sign in"}</a>
    </nav>
  </main>;
}
