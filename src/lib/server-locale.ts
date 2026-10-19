import { cookies } from "next/headers";
import type { Locale } from "./locale";

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get("fa_locale")?.value === "ar" ? "ar" : "en";
}
