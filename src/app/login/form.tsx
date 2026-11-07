"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale } from "@/lib/locale";

export function LoginForm({ destination, locale }: { destination: string; locale: Locale }) {
  const [busy,setBusy]=useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy)return;
    setBusy(true);
    try {
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if(response.status===429){const seconds=Number(response.headers.get("Retry-After"))||900;setError(t(`Too many attempts. Try again in ${Math.ceil(seconds/60)} minutes.`,`محاولات كثيرة. جرّب بعد ${Math.ceil(seconds/60)} دقيقة.`));return;}
    if (!response.ok) { setError(response.status===401?t("Email or password is incorrect.", "البريد الإلكتروني أو كلمة المرور غير صحيحة."):t("Sign-in could not be completed. Try again.","تعذر إكمال تسجيل الدخول. جرّب مرة أخرى.")); return; }
    router.push(destination);
    router.refresh();
    } catch {setError(t("Network request failed","فشل الاتصال بالشبكة"));} finally {setBusy(false);}
  }
  return <form onSubmit={submit} className="authform">
    <label>{t("Email", "البريد الإلكتروني")}<input type="email" name="email" required autoComplete="email" /></label>
    <label>{t("Password", "كلمة المرور")}<input type="password" name="password" maxLength={1024} required autoComplete="current-password" /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{t("Sign in", "تسجيل الدخول")}</button>
    <a href="/recover">{t("Forgot password? Use a saved backup code", "نسيت كلمة المرور؟ استخدم رمزًا احتياطيًا محفوظًا")}</a>
    <a href="/register">{t("Create a workspace", "إنشاء مساحة عمل")}</a>
  </form>;
}
