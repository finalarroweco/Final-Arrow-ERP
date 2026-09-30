import type { Metadata } from "next";
import "./styles.css";
import { getLocale } from "@/lib/server-locale";

export const metadata: Metadata = { title: "Final Arrow ERP", description: "Business operating system" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><body>{children}</body></html>;
}
