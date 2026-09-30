"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale } from "@/lib/locale";

export function LoginForm({ destination, locale }: { destination: string; locale: Locale }) {
  const [error, setError] = useState("");
  const router = useRouter();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok) { setError(t("Email or password is incorrect.", "البريد الإلكتروني أو كلمة المرور غير صحيحة.")); return; }
    router.push(destination);
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    <label>{t("Email", "البريد الإلكتروني")}<input type="email" name="email" required autoComplete="email" /></label>
    <label>{t("Password", "كلمة المرور")}<input type="password" name="password" required autoComplete="current-password" /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{t("Sign in", "تسجيل الدخول")}</button>
    <a href="/register">{t("Create a workspace", "إنشاء مساحة عمل")}</a>
  </form>;
}
