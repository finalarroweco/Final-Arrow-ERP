"use client";

import { translate, type Locale } from "@/lib/locale";
import { useRouter } from "next/navigation";

export function Logout({ locale }: { locale: Locale }) {
  const router = useRouter();
  return <button type="button" onClick={async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) { router.replace("/login"); router.refresh(); }
  }}>{translate(locale, "Sign out", "تسجيل الخروج")}</button>;
}
