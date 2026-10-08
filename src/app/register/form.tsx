"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale } from "@/lib/locale";

export function RegistrationForm({ locale }: { locale: Locale }) {
  const [error, setError] = useState("");
  const router = useRouter();
  const t = (en: string, ar: string) => translate(locale, en, ar);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    if (!response.ok) {
      setError(response.status === 409 ? t("Email or workspace name already in use.", "البريد الإلكتروني أو اسم مساحة العمل مستخدم بالفعل.") : t("Please check your details.", "تحقق من البيانات المدخلة."));
      return;
    }
    router.push("/workspace");
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    <label>{t("Your name", "اسمك")}<input name="name" required minLength={2} maxLength={120} /></label>
    <label>{t("Email", "البريد الإلكتروني")}<input type="email" name="email" required autoComplete="email" /></label>
    <label>{t("Password (12 characters minimum)", "كلمة المرور (12 حرفاً على الأقل)")}<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
    <label>{t("Organization", "المؤسسة")}<input name="organization" required minLength={2} maxLength={120} /></label>
    <label>{t("Workspace code", "رمز مساحة العمل")}<input name="slug" required pattern="[a-z0-9-]{3,40}" placeholder="my-company" /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit">{t("Create workspace", "إنشاء مساحة عمل")}</button><a href="/login">{t("Already have an account?", "لديك حساب بالفعل؟")}</a>
  </form>;
}
