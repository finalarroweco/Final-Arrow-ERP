import type { Metadata } from "next";
import localFont from "next/font/local";
import "./styles.css";
import { getLocale } from "@/lib/server-locale";

export const metadata: Metadata = { title: "Final Arrow ERP", description: "Business operating system" };
const tajawal = localFont({
  src: [{ path: "./fonts/Tajawal-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Tajawal-Bold.ttf", weight: "700", style: "normal" }],
  variable: "--font-tajawal", display: "swap", preload: false,
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={tajawal.variable}><body>{children}</body></html>;
}
