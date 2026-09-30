"use client";

import { useState, type FormEvent } from "react";
import { translate, type Locale } from "@/lib/locale";
import { useRouter } from "next/navigation";

export function AcceptForm({ token, needsAccount, locale }: { token: string; needsAccount: boolean; locale: Locale }) {
  const t = (en: string, ar: string) => translate(locale, en, ar);
  const [error, setError] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/invitations/accept", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...values }),
    });
    if (!response.ok) {
      const result: { error?: string } = await response.json();
      setError(result.error ?? t("Could not accept invitation", "تعذر قبول الدعوة"));
      return;
    }
    router.replace("/workspace");
    router.refresh();
  }
  return <form onSubmit={submit} className="authform">
    {needsAccount && <>
      <label>{t("Your name", "اسمك")}<input name="name" required minLength={2} maxLength={120} /></label>
      <label>{t("Password (12 characters minimum)", "كلمة المرور (12 حرفاً على الأقل)")}<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="submit">{t("Accept invitation", "قبول الدعوة")}</button>
  </form>;
}
